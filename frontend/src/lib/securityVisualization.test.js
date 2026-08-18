import { describe, expect, it } from 'vitest';
import {
  applyAttackEventsToTopology, buildObservedTopology, mapAlertToAttackEvent, orderScriptedEvents,
  validateAttackEvent,
  validateNetworkTopology,
  validateScenario,
} from './securityVisualization';

const topology = {
  nodes:[
    { id:'internet', label:'Internet', sublabel:'External', type:'external', state:'idle', position:{ x:0, y:0 } },
    { id:'firewall', label:'Firewall', sublabel:'10.0.0.1', type:'firewall', state:'monitoring', position:{ x:160, y:0 } },
  ],
  edges:[{ id:'internet-firewall', sourceNodeId:'internet', targetNodeId:'firewall', state:'idle' }],
};

describe('security visualization contracts', () => {
  it('accepts a valid topology and an event that references it', () => {
    expect(validateNetworkTopology(topology).nodeIds.has('firewall')).toBe(true);
    expect(validateAttackEvent({
      id:'event-1', timestamp:'2026-08-16T08:00:00Z', message:'Firewall received a suspicious request',
      eventType:'access', severity:'high', affectedNodeId:'firewall', affectedEdgeId:'internet-firewall',
    }, topology).id).toBe('event-1');
  });

  it('rejects broken topology and event references before rendering', () => {
    expect(() => validateNetworkTopology({ ...topology, edges:[{ ...topology.edges[0], targetNodeId:'missing' }] }))
      .toThrow('unknown target node');
    expect(() => validateAttackEvent({
      id:'event-2', timestamp:'2026-08-16T08:00:00Z', message:'Unknown target',
      eventType:'access', severity:'critical', affectedNodeId:'missing', affectedEdgeId:null,
    }, topology)).toThrow('unknown node');
  });

  it('validates scenario references and keeps equal-time events stable', () => {
    const scenario = {
      id:'dmz', name:'DMZ compromise', description:'Controlled web-server scenario', icon:'server',
      killChainStages:[{ id:'initial', tacticName:'Initial Access', techniqueId:'T1190', state:'upcoming' }],
      scriptedEvents:[
        { id:'second', timestampOffset:100, message:'Second event', relatedStageId:'initial', eventType:'access' },
        { id:'first', timestampOffset:0, message:'First event', relatedStageId:'initial', eventType:'access' },
        { id:'third', timestampOffset:100, message:'Third event', relatedStageId:'initial', eventType:'access' },
      ],
    };
    expect(validateScenario(scenario)).toBe(scenario);
    expect(orderScriptedEvents(scenario.scriptedEvents).map(event => event.id)).toEqual(['first', 'second', 'third']);
    expect(() => validateScenario({
      ...scenario,
      scriptedEvents:[{ ...scenario.scriptedEvents[0], relatedStageId:'missing' }],
    })).toThrow('unknown MITRE stage');
  });

  it('derives a bounded, connected topology from observed alert fields only', () => {
    const observed = buildObservedTopology([
      { src_ip:'203.0.113.44', hostname:'WEB-SRV01', target_db:'CUSTOMER-DB' },
      { src_ip:'203.0.113.44', hostname:'WEB-SRV01', target_db:'CUSTOMER-DB' },
      { src_ip:'198.51.100.24', hostname:'HR-WS001' },
    ]);
    expect(observed.evidenceCount).toBe(3);
    expect(observed.nodes).toHaveLength(5);
    expect(observed.nodes.every(node => node.state === 'idle')).toBe(true);
    expect(observed.nodes.map(node => node.sublabel)).toEqual(expect.arrayContaining([
      '203.0.113.44', 'WEB-SRV01', 'CUSTOMER-DB', '198.51.100.24', 'HR-WS001',
    ]));
    expect(observed.edges.some(edge => edge.sourceNodeId === 'source:203.0.113.44' && edge.targetNodeId === 'asset:web-srv01')).toBe(true);
    expect(observed.edges.every(edge => edge.observations > 0)).toBe(true);
  });

  it('maps one alert snapshot into synchronized node, edge, and narrative state', () => {
    const alert = {
      id:'elastic:critical-1', timestamp:'2026-08-16T08:00:00Z', src_ip:'203.0.113.44',
      hostname:'WEB-SRV01', target_db:'CUSTOMER-DB', rule_desc:'Suspicious database export',
    };
    const observed = buildObservedTopology([alert]);
    const event = mapAlertToAttackEvent(alert, observed, { title:'Suspicious database export', severity:'critical' });
    expect(event).toMatchObject({
      id:'attack:elastic:critical-1', eventType:'data-access', severity:'critical',
      affectedNodeId:'database:customer-db',
    });
    expect(event.message).toBe('Suspicious database export was observed on CUSTOMER-DB from 203.0.113.44');

    const active = applyAttackEventsToTopology(observed, [event]);
    expect(active.nodes.find(node => node.id === event.affectedNodeId).state).toBe('compromised');
    expect(active.edges.find(edge => edge.id === event.affectedEdgeId).state).toBe('active-traversal');

    const settled = applyAttackEventsToTopology(observed, [event], { activeEventId:null });
    expect(settled.edges.find(edge => edge.id === event.affectedEdgeId).state).toBe('traversed');
  });

  it('renders a containment outcome as resolved instead of an active attack hop', () => {
    const alert = { id:'blocked', timestamp:'2026-08-16T08:00:00Z', src_ip:'203.0.113.44', hostname:'WEB-SRV01' };
    const observed = buildObservedTopology([alert]);
    const event = mapAlertToAttackEvent(alert, observed, { title:'Connection blocked by firewall', severity:'high' });
    const resolved = applyAttackEventsToTopology(observed, [event]);
    expect(event.eventType).toBe('containment');
    expect(resolved.nodes.find(node => node.id === event.affectedNodeId).state).toBe('contained');
    expect(resolved.edges.find(edge => edge.id === event.affectedEdgeId).state).toBe('traversed');
  });
});
