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
      'UPDATE agent_runs SET hermes_run_id=COALESCE(hermes_run_id,$2) WHERE id=$1 AND status=\'running\'',
      [runId, hermesRunId]
    );
  }

  async function recordHermesStep({ runId, stepNumber, hermes, stepType, metadata = {} }) {
    await database.query(
      `INSERT INTO agent_run_steps(
         run_id,step_number,hermes_run_id,step_type,status,model,prompt_tokens,
         completion_tokens,total_tokens,attempts,latency_ms,metadata
       ) VALUES($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [runId, stepNumber, hermes.runId, stepType, hermes.model,
        hermes.usage.prompt_tokens, hermes.usage.completion_tokens, hermes.usage.total_tokens,
        hermes.attempts, hermes.latencyMs, json(metadata)]
    );
  }

  async function recordHermesStepFailure({ runId, stepNumber, hermesRunId, hermes = null, error }) {
    await database.query(
      `INSERT INTO agent_run_steps(
         run_id,step_number,hermes_run_id,step_type,status,model,prompt_tokens,
         completion_tokens,total_tokens,attempts,latency_ms,metadata
       ) VALUES($1,$2,$3,'unknown',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT (run_id,step_number) DO NOTHING`,
      [runId, stepNumber, hermesRunId,
        error?.code === 'HERMES_CANCELLED' ? 'cancelled' : 'failed', hermes?.model || null,
        hermes?.usage?.prompt_tokens || 0, hermes?.usage?.completion_tokens || 0,
        hermes?.usage?.total_tokens || 0, hermes?.attempts || error?.attempts || 0,
        hermes?.latencyMs || error?.latencyMs || 0,
        json({ error_code: error?.code || 'HERMES_RUN_FAILED' })]
    );
  }

  async function beginToolCall({ runId, hermesRunId, toolName, arguments: args }) {
    const result = await database.query(
      `INSERT INTO agent_tool_calls(run_id,hermes_call_id,tool_name,status,arguments)
       VALUES($1,$2,$3,'running',$4::jsonb) RETURNING id`,
      [runId, hermesRunId, String(toolName).slice(0, 100), json(args)]
    );
    return result.rows[0].id;
  }

  async function completeToolCall({ toolCallId, runId, actor, requestId, toolName, result, evidence: links }) {
    await transaction(database, async client => {
      await client.query(
        `UPDATE agent_tool_calls SET status='completed',result_summary=$2::jsonb,
           latency_ms=$3,finished_at=NOW() WHERE id=$1 AND status='running'`,
        [toolCallId, json({ bytes: result.bytes, evidence_count: links.length, truncated: result.data?.truncated === true }), result.latencyMs]
      );
      for (const item of links) {
        await client.query(
          `INSERT INTO agent_evidence_links(run_id,evidence_type,evidence_id,relation)
           VALUES($1,$2,$3,'input') ON CONFLICT DO NOTHING`,
          [runId, item.type, String(item.id)]
        );
      }
      await client.query(
        `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         VALUES($1,'agent.tool.completed','agent_tool_call',$2,'success',$3,$4::jsonb)`,
        [actor, String(toolCallId), requestId, json({ run_id: runId, tool: toolName, evidence_count: links.length })]
      );
    });
  }

  async function failToolCall({ toolCallId, runId, actor, requestId, toolName, error }) {
    const cancelled = error?.code === 'HERMES_CANCELLED';
    const denied = [
      'HERMES_TOOL_DENIED', 'HERMES_INVALID_TOOL_ARGUMENTS', 'HERMES_TOOL_BUDGET_EXHAUSTED',
      'HERMES_TOOL_UNAUTHORIZED',
    ].includes(error?.code);
    const status = cancelled ? 'cancelled' : denied ? 'denied' : 'failed';
    const outcome = cancelled ? 'cancelled' : denied ? 'denied' : 'failure';
    await transaction(database, async client => {
      await client.query(
        `UPDATE agent_tool_calls SET status=$2,error_code=$3,
           latency_ms=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-started_at))*1000)),finished_at=NOW()
         WHERE id=$1 AND status='running'`,
        [toolCallId, status, error?.code || 'HERMES_TOOL_FAILED']
      );
      await client.query(
        `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         VALUES($1,'agent.tool.failed','agent_tool_call',$2,$3,$4,$5::jsonb)`,
        [actor, String(toolCallId), outcome, requestId,
          json({ run_id: runId, tool: toolName, code: error?.code || 'HERMES_TOOL_FAILED' })]
      );
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

  return {
    attachHermesRun, beginChat, beginToolCall, completeChat, completeToolCall,
    failChat, failToolCall, recordHermesStep,
    recordHermesStepFailure,
  };
}

module.exports = { UUID_PATTERN, createAgentStore };
