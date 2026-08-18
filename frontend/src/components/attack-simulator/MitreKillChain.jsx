import {
  Archive, Database, DoorOpen, KeyRound, Search, Share2, ShieldAlert, ShieldCheck,
  Terminal, Upload,
} from 'lucide-react';
import { cx } from '../ui/utils';

function tacticIcon(tacticName) {
  const normalized = String(tacticName || '').toLowerCase();
  if (normalized.includes('initial')) return DoorOpen;
  if (normalized.includes('execution')) return Terminal;
  if (normalized.includes('credential')) return KeyRound;
  if (normalized.includes('discovery')) return Search;
  if (normalized.includes('lateral')) return Share2;
  if (normalized.includes('collection')) return Database;
  if (normalized.includes('staging')) return Archive;
  if (normalized.includes('exfiltration')) return Upload;
  return ShieldAlert;
}

function connectionState(stage) {
  if (stage.cut) return 'cut';
  if (stage.state === 'in-progress') return 'active';
  if (stage.state === 'completed' || stage.state === 'blocked') return 'traversed';
  return 'idle';
}

function StageConnection({ state }) {
  const cut = state === 'cut';
  return (
    <svg className={cx('mitre-stage-link', `is-${state}`)} viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
      {cut ? (
        <>
          <line x1="0" y1="2" x2="42" y2="2" />
          <line x1="58" y1="2" x2="100" y2="2" />
        </>
      ) : <line x1="0" y1="2" x2="100" y2="2" />}
    </svg>
  );
}

export default function MitreKillChain({ stages = [] }) {
  return (
    <ol
      className="mitre-kill-chain"
      style={{ '--mitre-stage-count':Math.max(stages.length, 1) }}
      aria-label="MITRE ATT&CK simulation progress"
      aria-live="polite"
    >
      {stages.map((stage, index) => {
        const Icon = stage.state === 'blocked' ? ShieldCheck : tacticIcon(stage.tacticName);
        return (
          <li
            key={stage.id}
            className={cx(`is-${stage.state}`, stage.cut && 'is-cut')}
            aria-label={`${stage.tacticName}, ${stage.state.replace('-', ' ')}`}
          >
            {index > 0 && <StageConnection state={connectionState(stage)} />}
            <span className="mitre-stage-node" aria-hidden="true">
              <Icon size={16} strokeWidth={1.5} />
            </span>
            <strong>{stage.tacticName}</strong>
            {stage.techniqueId && <code>{stage.techniqueId}</code>}
          </li>
        );
      })}
    </ol>
  );
}
