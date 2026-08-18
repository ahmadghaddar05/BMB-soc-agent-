import { describe, expect, it } from 'vitest';
import {
  ATTACK_SCENARIOS, attackScenarioById, deriveMitreProgress, deriveSimulationResponse,
  simulationDuration,
} from './attackSimulation';
import { validateScenario } from './securityVisualization';

describe('attack simulation catalog', () => {
  it('provides three immutable and valid controlled scenarios', () => {
    expect(ATTACK_SCENARIOS).toHaveLength(3);
    ATTACK_SCENARIOS.forEach(scenario => {
      expect(validateScenario(scenario)).toBe(scenario);
      expect(Object.isFrozen(scenario)).toBe(true);
      expect(Object.isFrozen(scenario.killChainStages)).toBe(true);
      expect(Object.isFrozen(scenario.scriptedEvents)).toBe(true);
      expect(new Set(scenario.killChainStages.map(stage => stage.id)).size).toBe(scenario.killChainStages.length);
    });
  });

  it('keeps each demo run between 15 and 25 seconds and ends in containment', () => {
    ATTACK_SCENARIOS.forEach(scenario => {
      expect(simulationDuration(scenario)).toBeGreaterThanOrEqual(15000);
      expect(simulationDuration(scenario)).toBeLessThanOrEqual(25000);
      expect(scenario.scriptedEvents.at(-1)).toMatchObject({ eventType:'containment', outcome:'blocked' });
    });
  });

  it('resolves scenarios by stable identifier without a fallback', () => {
    expect(attackScenarioById('insider-data-exfiltration')?.name).toBe('Insider Data Exfiltration');
    expect(attackScenarioById('missing')).toBeNull();
  });

  it('derives current, completed, blocked, and cut stages from one event snapshot', () => {
    const scenario = attackScenarioById('dmz-web-server-compromise');
    const idle = deriveMitreProgress(scenario, [], 'idle');
    expect(idle.every(stage => stage.state === 'upcoming')).toBe(true);

    const running = deriveMitreProgress(scenario, scenario.scriptedEvents.slice(0, 4), 'running');
    expect(running.map(stage => stage.state)).toEqual([
      'completed', 'completed', 'completed', 'in-progress', 'upcoming',
    ]);

    const contained = deriveMitreProgress(scenario, scenario.scriptedEvents, 'completed');
    expect(contained.map(stage => stage.state)).toEqual([
      'completed', 'completed', 'completed', 'blocked', 'upcoming',
    ]);
    expect(contained.at(-1).cut).toBe(true);
    expect(Object.isFrozen(contained)).toBe(true);
    expect(Object.isFrozen(contained[0])).toBe(true);
  });

  it('reveals response confidence and recommendations only as their events arrive', () => {
    const scenario = attackScenarioById('insider-data-exfiltration');
    const pending = deriveSimulationResponse(scenario, scenario.scriptedEvents.slice(0, 3), 'running');
    expect(pending).toMatchObject({ confidence:null, verdict:'Analyzing scenario', complete:false, summary:null });
    expect(pending.actions).toEqual([]);

    const correlated = deriveSimulationResponse(scenario, scenario.scriptedEvents.slice(0, 4), 'running');
    expect(correlated).toMatchObject({ confidence:88, verdict:'Probable malicious activity', complete:false });
    expect(correlated.actions).toEqual(['Suspend the test account pending analyst review']);

    const contained = deriveSimulationResponse(scenario, scenario.scriptedEvents, 'completed');
    expect(contained).toMatchObject({ confidence:98, verdict:'Attack contained', complete:true });
    expect(contained.actions).toHaveLength(3);
    expect(contained.summary).toBe('Contained in 17.5s · 1 system affected · 0 data loss');
    expect(Object.isFrozen(contained.actions)).toBe(true);
  });
});
