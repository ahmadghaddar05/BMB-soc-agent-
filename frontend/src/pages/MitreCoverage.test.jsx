import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import MitreCoverage from './MitreCoverage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const json = body => new Response(JSON.stringify(body), {
  status:200,
  headers:{ 'Content-Type':'application/json' },
});

async function settle(milliseconds = 80) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, milliseconds)); });
}

describe('MITRE Coverage', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('keeps the incident matrix and timeline on one evidence-backed incident object', async () => {
    globalThis.fetch = vi.fn(async input => {
      const url = String(input);
      if (url.endsWith('/api/mitre/incidents?limit=100')) return json({ incidents:[{
        id:7, reference:'INC-00007', name:'Credential attack path', severity:'critical',
        status:'open', alertCount:2, stageCount:2,
      }] });
      if (url.endsWith('/api/mitre/incidents/7')) return json({
        tactics:[
          { id:'TA0006', name:'Credential Access', order:6 },
          { id:'TA0008', name:'Lateral Movement', order:8 },
        ],
        incident:{
          id:7, reference:'INC-00007', name:'Credential attack path', severity:'critical', status:'open',
          firstSeen:'2026-08-18T08:00:00Z', lastSeen:'2026-08-18T08:10:00Z', alertCount:2, stageCount:2,
          alerts:[
            {
              id:'alert-1', name:'Password spray', timestamp:'2026-08-18T08:00:00Z', severity:'high',
              aiVerdict:'true_positive', state:'detected-confirmed', entity:'user-1', source:'elastic.alert',
              mappings:[{ tacticId:'TA0006', tacticName:'Credential Access', techniques:[{ id:'T1110.003', name:'Password Spraying' }] }],
              decisionTrace:{ reason:'Repeated failed logins preceded a successful login.', model:'llama-3.3-70b-instruct', inputSummary:{ events:12 }, outputSummary:{ verdict:'true_positive' }, limitations:[] },
            },
            {
              id:'alert-2', name:'SMB movement blocked', timestamp:'2026-08-18T08:10:00Z', severity:'critical',
              aiVerdict:'true_positive', state:'contained', entity:'WS-02', source:'edr', hostname:'WS-02',
              mappings:[{ tacticId:'TA0008', tacticName:'Lateral Movement', techniques:[{ id:'T1021.002', name:'SMB / Windows Admin Shares' }] }],
              decisionTrace:{ reason:'The endpoint source recorded the connection as prevented.', inputSummary:{ events:1 }, outputSummary:{ state:'contained' }, limitations:[] },
            },
          ],
        },
        response_simulations:[],
      });
      if (url.endsWith('/api/mitre/coverage?range=90')) return json({
        range:'90', summary:'2 of 3 tactics have recorded incident detection coverage. Persistence shows no recorded alerts in the last 90 days.',
        tactics:[
          { id:'TA0006', name:'Credential Access', totalAlertCount:14, incidentCount:3, detectionCount:2 },
          { id:'TA0008', name:'Lateral Movement', totalAlertCount:5, incidentCount:2, detectionCount:1 },
          { id:'TA0003', name:'Persistence', totalAlertCount:0, incidentCount:0, detectionCount:0 },
        ],
      });
      return json({});
    });

    root = createRoot(container);
    await act(async () => root.render(<MemoryRouter><MitreCoverage /></MemoryRouter>));
    await settle(160);

    expect(document.body.textContent).toContain('Credential attack path');
    expect(document.body.textContent).toContain('Password Spraying');
    expect(document.body.textContent).toContain('SMB movement blocked');
    expect(document.querySelectorAll('.mitre-alert-chip')).toHaveLength(2);
    expect(document.querySelectorAll('.mitre-alert-timeline > li')).toHaveLength(2);
    expect(document.querySelector('.mitre-alert-chip.is-contained')).not.toBeNull();

    const coverageButton = [...document.querySelectorAll('button')].find(button => button.textContent === 'Coverage View');
    await act(async () => coverageButton.click());
    await settle();

    expect(document.body.textContent).toContain('Detection coverage by ATT&CK tactic');
    expect(document.body.textContent).toContain('Persistence shows no recorded alerts');
    expect(document.querySelector('.mitre-coverage-column.level-0')).not.toBeNull();
  });
});
