'use strict';

const crypto = require('crypto');
const db = require('../../db');
const { HermesError } = require('./errors');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(value) {
  return JSON.stringify(value ?? {});
}

async function transaction(database, callback) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function createAgentStore(database = db) {
  async function beginChat({ conversationId, actor, question, requestId, promptVersion, schemaVersion }) {
    if (conversationId && !UUID_PATTERN.test(conversationId)) {
      throw new HermesError('INVALID_CONVERSATION_ID', 'conversation_id must be a valid UUID', { status: 400 });
    }
    const runId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    return transaction(database, async client => {
      let id = conversationId;
      if (id) {
        const existing = await client.query(
          `SELECT id FROM agent_conversations
           WHERE id=$1 AND created_by=$2 AND status='active' FOR UPDATE`,
          [id, actor]
        );
        if (!existing.rowCount) {
          throw new HermesError('CONVERSATION_NOT_FOUND', 'Conversation was not found', { status: 404 });
        }
      } else {
        const created = await client.query(
          `INSERT INTO agent_conversations(channel,created_by,title,metadata)
           VALUES('chat',$1,$2,$3::jsonb) RETURNING id`,
          [actor, String(question).slice(0, 120), json({ source: 'soc_web' })]
        );
        id = created.rows[0].id;
      }

      const historyResult = await client.query(
        `SELECT role, content FROM (
           SELECT id,role,content FROM agent_messages
           WHERE conversation_id=$1 AND role IN ('user','assistant')
           ORDER BY id DESC LIMIT 8
         ) recent ORDER BY id`,
        [id]
      );
      await client.query(
        `INSERT INTO agent_runs(
           id,conversation_id,purpose,status,actor,provider,prompt_version,
           output_schema_version,request_id,idempotency_key,input_summary
         ) VALUES($1,$2,'chat','running',$3,'hermes',$4,$5,$6,$7,$8::jsonb)`,
        [runId, id, actor, promptVersion, schemaVersion, requestId, idempotencyKey,
          json({ question_chars: question.length })]
      );
      await client.query(
        `INSERT INTO agent_messages(conversation_id,role,content,run_id,metadata)
         VALUES($1,'user',$2,$3,$4::jsonb)`,
        [id, question, runId, json({ request_id: requestId })]
      );
      await client.query(
        `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         VALUES($1,'agent.run.started','agent_run',$2,'success',$3,$4::jsonb)`,
        [actor, runId, requestId, json({ purpose: 'chat', conversation_id: id, provider: 'hermes' })]
      );
      return { conversationId: id, runId, idempotencyKey, history: historyResult.rows };
    });
  }

  async function attachHermesRun(runId, hermesRunId) {
    await database.query(
      'UPDATE agent_runs SET hermes_run_id=$2 WHERE id=$1 AND status=\'running\'',
      [runId, hermesRunId]
    );
  }

  async function recordEvidenceSnapshot(runId, evidence, latencyMs) {
    await transaction(database, async client => {
      await client.query(
        `INSERT INTO agent_tool_calls(
           run_id,tool_name,status,arguments,result_summary,latency_ms,finished_at
         ) VALUES($1,'soc_evidence_snapshot','completed',$2::jsonb,$3::jsonb,$4,NOW())`,
        [runId, json({ hours: 24 }), json({
          generated_at: evidence.generated_at,
          alert_count: evidence.alerts.length,
          incident_count: evidence.incidents.length,
        }), latencyMs]
      );
      for (const item of evidence.alerts) {
        await client.query(
          `INSERT INTO agent_evidence_links(run_id,evidence_type,evidence_id,relation)
           VALUES($1,'alert',$2,'input') ON CONFLICT DO NOTHING`,
          [runId, String(item.id)]
        );
      }
      for (const item of evidence.incidents) {
        await client.query(
          `INSERT INTO agent_evidence_links(run_id,evidence_type,evidence_id,relation)
           VALUES($1,'incident',$2,'input') ON CONFLICT DO NOTHING`,
          [runId, String(item.id)]
        );
      }
    });
  }

  async function completeChat({ runId, conversationId, actor, requestId, output, hermes }) {
    await transaction(database, async client => {
      await client.query(
        `UPDATE agent_runs SET status='completed',model=$2,capabilities=$3::jsonb,
           output_summary=$4::jsonb,prompt_tokens=$5,completion_tokens=$6,total_tokens=$7,
           attempts=$8,latency_ms=$9,finished_at=NOW()
         WHERE id=$1 AND status='running'`,
        [runId, hermes.model, json(hermes.capabilities), json({
          confidence: output.confidence,
          citation_count: output.citations.length,
          limitation_count: output.limitations?.length || 0,
        }), hermes.usage.prompt_tokens, hermes.usage.completion_tokens, hermes.usage.total_tokens,
          hermes.attempts, hermes.latencyMs]
      );
      await client.query(
        `INSERT INTO agent_messages(conversation_id,role,content,run_id,metadata)
         VALUES($1,'assistant',$2,$3,$4::jsonb)`,
        [conversationId, output.answer, runId, json({
          confidence: output.confidence,
          citations: output.citations,
          limitations: output.limitations || [],
          provider: 'hermes',
        })]
      );
      for (const citation of output.citations) {
        await client.query(
          `INSERT INTO agent_evidence_links(run_id,evidence_type,evidence_id,relation)
           VALUES($1,$2,$3,'citation') ON CONFLICT DO NOTHING`,
          [runId, citation.type, String(citation.id)]
        );
      }
      await client.query('UPDATE agent_conversations SET updated_at=NOW() WHERE id=$1', [conversationId]);
      await client.query(
        `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         VALUES($1,'agent.run.completed','agent_run',$2,'success',$3,$4::jsonb)`,
        [actor, runId, requestId, json({
          provider: 'hermes', model: hermes.model, hermes_run_id: hermes.runId,
          total_tokens: hermes.usage.total_tokens,
        })]
      );
    });
  }

  async function failChat({ runId, actor, requestId, error }) {
    const cancelled = error?.code === 'HERMES_CANCELLED';
    const status = cancelled ? 'cancelled' : 'failed';
    const outcome = cancelled ? 'cancelled' : 'failure';
    await transaction(database, async client => {
      await client.query(
        `UPDATE agent_runs SET status=$2,error_code=$3,error_category=$4,error_message=$5,
           hermes_run_id=COALESCE(hermes_run_id,$6),attempts=GREATEST(attempts,$7),
           finished_at=NOW(),latency_ms=GREATEST(latency_ms,$8,FLOOR(EXTRACT(EPOCH FROM (NOW()-started_at))*1000))
         WHERE id=$1 AND status='running'`,
        [runId, status, error?.code || 'HERMES_UNAVAILABLE', error?.name || 'Error',
          String(error?.message || 'Hermes run failed').slice(0, 500), error?.hermesRunId || null,
          error?.attempts || 0, error?.latencyMs || 0]
      );
      await client.query(
        `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         VALUES($1,'agent.run.failed','agent_run',$2,$3,$4,$5::jsonb)`,
        [actor, runId, outcome, requestId, json({ code: error?.code || 'HERMES_UNAVAILABLE' })]
      );
    });
  }

  return { attachHermesRun, beginChat, completeChat, failChat, recordEvidenceSnapshot };
}

module.exports = { UUID_PATTERN, createAgentStore };
