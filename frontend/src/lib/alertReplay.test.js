import { describe, expect, it } from 'vitest';
import {
  buildAlertReplay, deriveReplayMitreProgress, deriveReplayTopology,
} from './alertReplay';

const alert = {
  id:'elastic:replay-1',
  timestamp:'2026-08-18T08:00:00.000Z',
  rule_desc:'Suspicious PowerShell execution',
  event_action:'process-started',
  event_dataset:'edr.endpoint',
  source_severity:'critical',
  src_ip:'203.0.113.44',
  hostname:'DEV-WS002',
  username:'maya.georges',
  process:'powershell.exe',
  mitre_tactics:['execution', 'command_and_control'],
  mitre_techniques:['T1059.001', 'T1071.001'],
  raw:{ process:{ parent:{ name:'explorer.exe' } }, destination:{ ip:'198.51.100.20' } },
  triage_status:'triaged',
  verdict:{
    verdict:'true_positive', confidence:.91, severity:'critical', attack_stage:'execution',
    narrative:'PowerShell opened an unusual external connection.',
    key_findings:['Unsigned PowerShell process contacted an external address.'],
    limitations:['The downloaded file was not recovered.'],
    recommended_actions:['Isolate DEV-WS002.'],
  },
};

const journey = {
  stages:[
    { id:1, stage:'collected', status:'completed', reason:'Stored.' },
    { id:2, stage:'enriched', status:'completed', reason:'Context added.' },
    {
      id:3, stage:'triaged', status:'completed', executor_type:'ai', provider:'hermes',
      model:'meta-llama/llama-3.3-70b-instruct', confidence:.91,
      reason:'PowerShell opened an unusual external connection.',
      input_summary:{ evidence_count:6, process:'powershell.exe', target:'DEV-WS002' },
      output_summary:{ verdict:'true_positive', severity:'critical' },
      limitations:['The downloaded file was not recovered.'],
    },
    {
      id:4, stage:'correlated', status:'completed', reason:'Shared host and identity linked two alerts.',
      input_summary:{ candidate_count:2 }, output_summary:{ decision:'linked' },
    },
    {
      id:5, stage:'incident_decision', status:'completed', reason:'Added to an open incident.',
      input_summary:{ correlation_decision:'linked', severity:'critical' },
      output_summary:{ decision:'promoted' },
    },
  ],
  current_state:{ incident:{ id:17, title:'PowerShell command and control', severity:'critical', status:'open' } },
  analyst_reviews:[],
};

describe('real alert replay adapter', () => {
  it('starts with observed security action and omits collection and enrichment mechanics', () => {
    const replay = buildAlertReplay(alert, journey);
    expect(replay.triageReady).toBe(true);
    expect(replay.title).toBe('Suspicious PowerShell execution');
    expect(replay.scriptedEvents[0]).toMatchObject({ category:'observed' });
    expect(replay.scriptedEvents.some(event => /collect|enrich|normaliz/i.test(event.title))).toBe(false);
    expect(replay.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
      'source', 'action', 'target', 'ai', 'correlation', 'decision',
    ]));
    expect(replay.nodes.find(node => node.id === 'source')?.sublabel).toBe('203.0.113.44');
    expect(replay.nodes.find(node => node.id === 'action')?.sublabel).toBe('powershell.exe');
    expect(replay.scriptedEvents.map(event => event.phase)).toEqual([
      'observed', 'evidence', 'inference', 'verdict', 'correlation', 'incident',
    ]);
    expect(replay.observed.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label:'Process', value:'powershell.exe' }),
      expect.objectContaining({ label:'Parent process', value:'explorer.exe' }),
    ]));
  });

  it('uses persisted AI, correlation, and incident decisions without inventing outcomes', () => {
    const replay = buildAlertReplay(alert, journey);
    expect(replay.ai).toMatchObject({
      verdict:'True Positive', confidence:91,
      model:'meta-llama/llama-3.3-70b-instruct',
      correlation:{ recorded:true, status:'Linked' },
      incidentDecision:{ recorded:true, status:'INC-00017' },
    });
    expect(replay.ai.inputFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label:'Process', value:'powershell.exe' }),
    ]));
    expect(replay.ai.correlation.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ label:'Candidate Count', value:'2' }),
    ]));
    expect(replay.ai.incidentDecision.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ label:'Decision', value:'promoted' }),
    ]));
    expect(replay.scriptedEvents.find(event => event.id.endsWith(':correlation'))?.message)
      .toBe('Shared host and identity linked two alerts.');
    expect(replay.scriptedEvents.find(event => event.id.endsWith(':decision'))?.title)
      .toBe('INC-00017 linked');
  });

  it('animates one synchronized topology and ATT&CK state from the same visible events', () => {
    const replay = buildAlertReplay(alert, journey);
    const visible = replay.scriptedEvents.slice(0, 4);
    const current = visible.at(-1);
    const topology = deriveReplayTopology(replay, visible, current.id);
    expect(topology.nodes.find(node => node.id === current.affectedNodeId)?.state).toBe(current.nodeState);
    if (current.affectedEdgeId) {
      expect(topology.edges.find(edge => edge.id === current.affectedEdgeId)?.state).toBe('active-traversal');
    }
    const mitre = deriveReplayMitreProgress(replay, visible);
    expect(mitre.length).toBeGreaterThan(0);
    expect(mitre.some(stage => stage.state !== 'upcoming')).toBe(true);
  });

  it('marks absent correlation and incident provenance as unavailable', () => {
    const replay = buildAlertReplay(alert, { stages:journey.stages.slice(0, 3), current_state:{ incident:null } });
    expect(replay.ai.correlation).toMatchObject({ recorded:false, status:'Not recorded' });
    expect(replay.ai.incidentDecision).toMatchObject({ recorded:false, status:'Not recorded' });
    expect(replay.scriptedEvents.find(event => event.id.endsWith(':correlation'))?.nodeState).toBe('unavailable');
    expect(replay.scriptedEvents.find(event => event.id.endsWith(':decision'))?.nodeState).toBe('unavailable');
  });

  it('does not pretend a pending alert has an AI replay', () => {
    const replay = buildAlertReplay({ ...alert, triage_status:'pending', verdict:null }, { stages:[] });
    expect(replay.triageReady).toBe(false);
    expect(replay.ai.verdict).toBe('Awaiting AI assessment');
    expect(replay.scriptedEvents.every(event => event.category === 'observed')).toBe(true);
  });
});
