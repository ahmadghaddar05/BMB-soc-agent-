import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AlertReplayScene from './AlertReplayScene';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const replay = {
  reference:'ALT-REPLAY01', severity:'critical',
  observed:{
    source:'203.0.113.44', action:'Suspicious Powershell Execution', target:'DEV-WS002',
    facts:[
      { id:'process', label:'Process', value:'powershell.exe', type:'process' },
      { id:'identity', label:'Identity', value:'maya.georges', type:'identity' },
    ],
  },
  ai:{
    model:'meta-llama/llama-3.3-70b-instruct', provider:'hermes', verdict:'Needs Investigation', confidence:55,
    rationale:'The behavior is suspicious, but process ancestry is missing.',
    inputFacts:[{ id:'fact-1', label:'Process', value:'powershell.exe' }],
    outputFacts:[{ id:'fact-2', label:'Verdict', value:'needs_investigation' }],
    findings:['PowerShell contacted an external address.'], limitations:['Parent process was not recorded.'],
    correlation:{ recorded:true, status:'Not linked', reason:'No matching activity met the threshold.', inputs:[{ id:'candidate', label:'Candidate Count', value:'0' }], outputs:[{ id:'decision', label:'Decision', value:'not_linked' }] },
    incidentDecision:{ recorded:true, status:'Not promoted', reason:'The incident threshold was not met.', inputs:[{ id:'severity', label:'Severity', value:'high' }], outputs:[{ id:'decision', label:'Decision', value:'not_promoted' }], incident:null },
  },
};

describe('AlertReplayScene', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders a different evidence-grounded operation map for every replay phase', async () => {
    const expectations = [
      ['observed', 'Security action', 'Suspicious Powershell Execution'],
      ['evidence', 'Inputs presented to the model', 'meta-llama/llama-3.3-70b-instruct'],
      ['inference', 'Recorded model rationale', 'process ancestry is missing'],
      ['verdict', 'Analyst review required', '55%'],
      ['correlation', 'Candidate and match inputs', 'No matching activity met the threshold'],
      ['incident', 'Incident policy gate', 'The incident threshold was not met'],
    ];

    for (const [phase, label, value] of expectations) {
      await act(async () => root.render(<AlertReplayScene replay={replay} event={{ phase, title:`${phase} active` }} />));
      expect(container.textContent).toContain(label);
      expect(container.textContent).toContain(value);
    }
  });
});
