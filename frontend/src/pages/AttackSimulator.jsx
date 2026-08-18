import {
  Archive, BrainCircuit, Database, DoorOpen, KeyRound, LoaderCircle, Play, Search,
  Server, Share2, ShieldCheck, Terminal,
} from 'lucide-react';
import { useRef, useState } from 'react';
import MitreKillChain from '../components/attack-simulator/MitreKillChain';
import SimulationResponse from '../components/attack-simulator/SimulationResponse';
import {
  Button, Card, LiveIndicator, SkeletonLoader, StatusChip, Timeline,
} from '../components/ui';
import useSynchronizedEventStream from '../hooks/useSynchronizedEventStream';
import {
  ATTACK_SCENARIOS, attackScenarioById, deriveMitreProgress, deriveSimulationResponse,
} from '../lib/attackSimulation';

const SCENARIO_ICONS = {
  database:Database,
  key:KeyRound,
  server:Server,
};

const EVENT_ICONS = {
  access:DoorOpen,
  collection:Archive,
  containment:ShieldCheck,
  correlation:BrainCircuit,
  credential:KeyRound,
  'data-access':Database,
  discovery:Search,
  execution:Terminal,
  'lateral-movement':Share2,
};

function eventTimestamp(event) {
  const date = new Date(event.emittedAt || Date.now());
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    : 'Now';
}

export default function AttackSimulator() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(ATTACK_SCENARIOS[0].id);
  const scenarioRefs = useRef([]);
  const stream = useSynchronizedEventStream();
  const selectedScenario = attackScenarioById(selectedScenarioId) || ATTACK_SCENARIOS[0];
  const running = stream.status === 'running';
  const completed = stream.status === 'completed';
  const mitreStages = deriveMitreProgress(selectedScenario, stream.events, stream.status);
  const response = deriveSimulationResponse(selectedScenario, stream.events, stream.status);
  const stageById = new Map(selectedScenario.killChainStages.map(stage => [stage.id, stage]));
  const timelineItems = stream.events.map(event => {
    const EventIcon = EVENT_ICONS[event.eventType] || BrainCircuit;
    const stage = stageById.get(event.relatedStageId);
    const final = completed && event.id === stream.events.at(-1)?.id && event.outcome === 'blocked';
    return {
      id:event.id,
      timestamp:eventTimestamp(event),
      dateTime:event.emittedAt,
      title:event.message,
      detail:stage ? `${stage.techniqueId || 'MITRE'} · ${stage.tacticName}` : null,
      eventType:event.eventType,
      severity:event.severity,
      tone:final ? 'success' : undefined,
      final,
      icon:<EventIcon size={12} strokeWidth={1.5} />,
    };
  });

  function selectScenario(id) {
    if (running || id === selectedScenarioId) return;
    stream.reset();
    setSelectedScenarioId(id);
  }

  function runSimulation() {
    stream.play(selectedScenario.scriptedEvents);
  }

  function handleScenarioKeyDown(event, index) {
    if (running) return;
    const lastIndex = ATTACK_SCENARIOS.length - 1;
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index === lastIndex ? 0 : index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index === 0 ? lastIndex : index - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex == null) return;
    event.preventDefault();
    selectScenario(ATTACK_SCENARIOS[nextIndex].id);
    scenarioRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="attack-simulator-page ui-page-enter">
      <Card
        className="attack-scenario-selector"
        title="Attack Simulation"
        caption="Choose a controlled scenario to observe detection and response decisions."
        action={<StatusChip status="active" className="simulation-mode-chip">SIMULATION MODE</StatusChip>}
      >
        <div className="attack-scenario-grid" role="radiogroup" aria-label="Attack simulation scenarios">
          {ATTACK_SCENARIOS.map((scenario, index) => {
            const Icon = SCENARIO_ICONS[scenario.icon] || Server;
            const selected = scenario.id === selectedScenarioId;
            return (
              <button
                key={scenario.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className="attack-scenario-option"
                disabled={running}
                onClick={() => selectScenario(scenario.id)}
                onKeyDown={event => handleScenarioKeyDown(event, index)}
                ref={element => { scenarioRefs.current[index] = element; }}
              >
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  <strong>{scenario.name}</strong>
                  <small>{scenario.description}</small>
                </span>
                <i aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <footer className="attack-scenario-actions">
          <span className="attack-scenario-selection" aria-live="polite">
            {running ? `Running ${selectedScenario.name}` : completed ? `${selectedScenario.name} completed` : `${selectedScenario.name} selected`}
          </span>
          <Button
            variant="primary"
            icon={running ? LoaderCircle : Play}
            className={running ? 'attack-simulation-run is-loading' : 'attack-simulation-run'}
            disabled={running}
            onClick={runSimulation}
          >
            {running ? 'Simulation Running…' : completed ? 'Run Again' : 'Run Simulation'}
          </Button>
        </footer>
      </Card>

      {(running || completed) && (
        <>
          <Card
            className="mitre-kill-chain-card"
            title="MITRE ATT&CK Kill Chain"
            caption={selectedScenario.name}
            action={<StatusChip status={completed ? 'resolved' : 'active'}>{completed ? 'Blocked' : 'Running'}</StatusChip>}
          >
            <div className="mitre-kill-chain-viewport">
              <MitreKillChain stages={mitreStages} />
            </div>
          </Card>

          <div className="simulation-runtime-grid">
            <Card
              className="simulation-log-card"
              title="Live Simulation Log"
              caption={`${timelineItems.length} of ${selectedScenario.scriptedEvents.length} events`}
              action={running ? <LiveIndicator label="Running" /> : <StatusChip status="resolved">Contained</StatusChip>}
            >
              {timelineItems.length ? (
                <div className="simulation-log-scroll">
                  <Timeline
                    items={timelineItems}
                    className="simulation-log"
                    ariaLabel="Live simulation narrative"
                    live
                    autoScroll
                  />
                </div>
              ) : <SkeletonLoader lines={3} className="simulation-log-skeleton" />}
            </Card>
            <SimulationResponse response={response} />
          </div>
        </>
      )}
    </div>
  );
}
