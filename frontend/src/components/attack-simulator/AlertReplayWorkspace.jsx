import {
  AlertTriangle, BrainCircuit, Check, ChevronLeft, ChevronRight, CircleDashed,
  Eye, GitMerge, ListRestart, Pause, Play, Radio, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import {
  buildAlertReplay, deriveReplayMitreProgress, deriveReplayTopology,
} from '../../lib/alertReplay';
import { activityTitle, alertReference, severityOf } from '../../lib/executive';
import useAlertReplayPlayback from '../../hooks/useAlertReplayPlayback';
import NetworkTopologyCanvas from '../digital-twin/NetworkTopologyCanvas';
import {
  Button, Card, ConfidenceGauge, EmptyState, LiveIndicator, Select,
  SeverityBadge, SkeletonLoader, StatusChip,
} from '../ui';
import MitreKillChain from './MitreKillChain';

const EMPTY_EVENTS = Object.freeze([]);

function ready(alert) {
  return String(alert?.triage_status || '').toLowerCase() === 'triaged' || Boolean(alert?.verdict);
}

function statusForStep(step, currentEvent, visibleEvents) {
  const index = visibleEvents.findIndex(event => event.id === step.eventId);
  if (currentEvent?.id === step.eventId) return 'active';
  if (index >= 0) return step.recorded === false ? 'unavailable' : 'complete';
  return 'upcoming';
}

function ReplayStep({ label, detail, status, icon:Icon }) {
  const StatusIcon = status === 'complete' ? Check : status === 'unavailable' ? CircleDashed : Icon;
  return (
    <li className={`alert-replay-step is-${status}`}>
      <span><StatusIcon size={16} strokeWidth={1.5} aria-hidden="true" /></span>
      <div><strong>{label}</strong><small>{detail}</small></div>
    </li>
  );
}

function ReplaySelector({ alerts, loading, error, onSelect, onReload }) {
  if (loading) return <div className="alert-replay-selector-loading"><SkeletonLoader lines={6} /></div>;
  if (error) return <EmptyState icon={AlertTriangle} message="Alert replay data is unavailable" action={<Button icon={RefreshCw} onClick={onReload}>Retry</Button>} />;
  if (!alerts.length) return <EmptyState icon={ShieldCheck} message="No triaged alerts are ready to replay" action={<Button as={Link} to="/live-monitoring">Open Live Monitoring</Button>} />;
  return (
    <ol className="alert-replay-alert-list" aria-label="Triaged alerts available for replay">
      {alerts.map(alert => (
        <li key={alert.id}>
          <button type="button" onClick={() => onSelect(alert.id)}>
            <span className="alert-replay-list-marker"><Radio size={16} strokeWidth={1.5} aria-hidden="true" /></span>
            <span>
              <strong>{activityTitle(alert)}</strong>
              <code>{alertReference(alert)}</code>
            </span>
            <SeverityBadge severity={severityOf(alert)} />
            <StatusChip status={ready(alert) ? 'active' : 'neutral'}>{ready(alert) ? 'AI triaged' : 'AI pending'}</StatusChip>
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function AlertReplayWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('alert') || '';
  const autoplay = searchParams.get('autoplay') === '1';
  const [alerts, setAlerts] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState(null);
  const [journey, setJourney] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const autoplayedRef = useRef('');

  useEffect(() => {
    let active = true;
    setListLoading(true);
    api('/alerts?page=1&limit=12&triage_status=triaged')
      .then(result => {
        if (!active) return;
        setAlerts(result.alerts || []);
        setListError('');
      })
      .catch(error => { if (active) setListError(error.message || 'Unable to load alerts.'); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setJourney(null);
      setDetailError('');
      return undefined;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    Promise.all([
      api(`/alerts/${encodeURIComponent(selectedId)}`),
      api(`/alerts/${encodeURIComponent(selectedId)}/journey`),
    ]).then(([alertResult, journeyResult]) => {
      if (!active) return;
      setDetail(alertResult);
      setJourney(journeyResult);
    }).catch(error => {
      if (active) setDetailError(error.message || 'Unable to load the recorded alert journey.');
    }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [reloadKey, selectedId]);

  const replay = useMemo(() => {
    if (!detail) return null;
    try { return buildAlertReplay(detail, journey || {}); } catch { return null; }
  }, [detail, journey]);
  const playback = useAlertReplayPlayback(replay?.scriptedEvents || EMPTY_EVENTS);

  useEffect(() => {
    if (!autoplay || !replay?.triageReady || autoplayedRef.current === replay.id) return;
    autoplayedRef.current = replay.id;
    playback.play();
  }, [autoplay, playback.play, replay]);

  const topology = useMemo(() => replay
    ? deriveReplayTopology(replay, playback.visibleEvents, playback.currentEvent?.id)
    : { nodes:[], edges:[] }, [playback.currentEvent?.id, playback.visibleEvents, replay]);
  const mitreStages = useMemo(() => replay
    ? deriveReplayMitreProgress(replay, playback.visibleEvents) : [], [playback.visibleEvents, replay]);

  function chooseAlert(id) {
    autoplayedRef.current = '';
    setSearchParams({ alert:id });
  }

  function closeReplay() {
    autoplayedRef.current = '';
    setSearchParams({});
  }

  if (!selectedId) {
    return (
      <Card
        className="alert-replay-selector"
        title="Select a real alert"
        caption="Replay its observed attack action and recorded AI decision path."
        action={<StatusChip status="active">RECORDED REPLAY</StatusChip>}
      >
        <ReplaySelector alerts={alerts} loading={listLoading} error={listError} onSelect={chooseAlert} onReload={() => setReloadKey(value => value + 1)} />
      </Card>
    );
  }

  if (detailLoading) return <Card className="alert-replay-loading"><SkeletonLoader lines={8} /></Card>;
  if (detailError || !replay) {
    return <Card><EmptyState icon={AlertTriangle} message="This alert replay could not be loaded" action={<Button onClick={() => setReloadKey(value => value + 1)}>Retry</Button>} /></Card>;
  }

  const current = playback.currentEvent;
  const triageEvent = replay.scriptedEvents.find(event => event.id.endsWith(':ai'));
  const verdictEvent = replay.scriptedEvents.find(event => event.id.endsWith(':verdict'));
  const correlationEvent = replay.scriptedEvents.find(event => event.id.endsWith(':correlation'));
  const decisionEvent = replay.scriptedEvents.find(event => event.id.endsWith(':decision'));
  const steps = [
    { label:'Observed action', detail:replay.nodes.find(node => node.id === 'action')?.label || replay.title, eventId:replay.scriptedEvents.find(event => event.category === 'observed')?.id, icon:Eye, recorded:true },
    { label:'Evidence reasoning', detail:replay.ai.model || 'Recorded AI assessment', eventId:triageEvent?.id, icon:BrainCircuit, recorded:Boolean(triageEvent) },
    { label:replay.ai.verdict, detail:replay.ai.confidence == null ? 'Confidence not supplied' : `${replay.ai.confidence}% confidence`, eventId:verdictEvent?.id, icon:ShieldCheck, recorded:Boolean(verdictEvent) },
    { label:'Correlation', detail:replay.ai.correlation.status, eventId:correlationEvent?.id, icon:GitMerge, recorded:replay.ai.correlation.recorded },
    { label:'Incident decision', detail:replay.ai.incidentDecision.status, eventId:decisionEvent?.id, icon:ShieldCheck, recorded:replay.ai.incidentDecision.recorded },
  ];
  const verdictVisible = playback.visibleEvents.some(event => event.id === verdictEvent?.id);
  const replayFinished = playback.completed;

  return (
    <div className="alert-replay-workspace">
      <Card className="alert-replay-identity ui-card-compact">
        <div>
          <Button icon={ChevronLeft} iconOnly onClick={closeReplay} aria-label="Choose another alert" title="Choose another alert" />
          <span><small>Real alert replay</small><strong>{replay.title}</strong><code>{replay.reference}</code></span>
        </div>
        <SeverityBadge severity={replay.severity} />
        <StatusChip status={replay.triageReady ? 'active' : 'attention'}>{replay.triageReady ? 'AI triaged' : 'AI pending'}</StatusChip>
        <Button as={Link} to="/live-monitoring" variant="secondary">Live Monitoring</Button>
      </Card>

      {!replay.triageReady ? (
        <Card><EmptyState icon={BrainCircuit} message="AI assessment is still pending for this alert" action={<Button as={Link} to={`/alerts?time_range=all&search=${encodeURIComponent(replay.id)}`}>Open Technical Triage</Button>} /></Card>
      ) : (
        <>
          <div className="alert-replay-layout">
            <Card
              className="alert-replay-map-card"
              title="Attack and AI decision map"
              caption="Observed entities and persisted decisions only."
              action={playback.running ? <LiveIndicator label="Replaying" /> : <StatusChip status={replayFinished ? 'resolved' : 'neutral'}>{replayFinished ? 'Replay complete' : 'Ready'}</StatusChip>}
            >
              <NetworkTopologyCanvas nodes={topology.nodes} edges={topology.edges} />
              <div className="alert-replay-current" aria-live="polite">
                <span className={`is-${current?.category || 'idle'}`}>{current ? current.category : 'ready'}</span>
                <div>
                  <strong>{current?.title || 'Ready to reconstruct this alert'}</strong>
                  <p>{current?.detail || 'Start the replay to follow the observed action and AI decision.'}</p>
                </div>
                <small>{Math.max(0, playback.cursor + 1)} / {replay.scriptedEvents.length}</small>
              </div>
              <div className="alert-replay-progress" aria-hidden="true"><i style={{ width:`${replay.scriptedEvents.length ? ((playback.cursor + 1) / replay.scriptedEvents.length) * 100 : 0}%` }} /></div>
              <div className="alert-replay-controls" aria-label="Replay controls">
                <Button icon={ListRestart} iconOnly onClick={playback.restart} aria-label="Restart replay" title="Restart replay" />
                <Button icon={ChevronLeft} iconOnly onClick={playback.previous} disabled={playback.cursor <= 0} aria-label="Previous step" title="Previous step" />
                <Button variant="primary" icon={playback.running ? Pause : Play} onClick={playback.running ? playback.pause : playback.play}>
                  {playback.running ? 'Pause' : playback.completed ? 'Replay' : playback.status === 'paused' ? 'Resume' : 'Run Replay'}
                </Button>
                <Button icon={ChevronRight} iconOnly onClick={playback.next} disabled={playback.cursor >= replay.scriptedEvents.length - 1} aria-label="Next step" title="Next step" />
                <Select aria-label="Replay speed" value={String(playback.speed)} onChange={event => playback.setSpeed(event.target.value)}>
                  <option value="0.75">0.75×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option>
                </Select>
              </div>
            </Card>

            <Card className="alert-replay-ai-card" title="How the AI reached its result" caption="Progressive view of the recorded decision ledger.">
              <ConfidenceGauge value={verdictVisible ? replay.ai.confidence : null} label={verdictVisible ? replay.ai.verdict : 'Waiting for AI step'} />
              <ol className="alert-replay-steps">
                {steps.map(step => <ReplayStep key={step.label} {...step} status={statusForStep(step, current, playback.visibleEvents)} />)}
              </ol>
              {current?.evidence?.length > 0 && (
                <section className="alert-replay-evidence" aria-live="polite">
                  <span>Evidence in this step</span>
                  <div>{current.evidence.slice(0, 4).map((item, index) => <small key={`${item}-${index}`}>{item}</small>)}</div>
                </section>
              )}
              {verdictVisible && replay.ai.limitations.length > 0 && (
                <section className="alert-replay-limitations">
                  <span>Model limitations</span>
                  <ul>{replay.ai.limitations.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul>
                </section>
              )}
              {replayFinished && (
                <div className="alert-replay-outcome" role="status">
                  <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span><strong>{replay.ai.verdict}</strong><small>{replay.ai.incidentDecision.status}</small></span>
                </div>
              )}
            </Card>
          </div>

          {mitreStages.length > 0 && (
            <Card className="alert-replay-mitre" title="Observed MITRE ATT&CK path" caption="Mappings stored with this alert; no tactics are inferred.">
              <div className="mitre-kill-chain-viewport"><MitreKillChain stages={mitreStages} /></div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

