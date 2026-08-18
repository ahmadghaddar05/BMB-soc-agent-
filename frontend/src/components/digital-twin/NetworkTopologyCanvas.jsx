import { useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle, Database, Globe2, LocateFixed, Minus, Monitor, Plus, Server, Shield,
} from 'lucide-react';
import { Button } from '../ui';

const WIDTH = 960;
const HEIGHT = 520;
const NODE_WIDTH = 120;
const NODE_HEIGHT = 72;

const NODE_ICONS = {
  firewall:Shield,
  server:Server,
  database:Database,
  workstation:Monitor,
  external:Globe2,
};

const LEGEND = [
  ['idle', 'Idle'],
  ['monitoring', 'Monitoring'],
  ['targeted', 'Targeted'],
  ['compromised', 'Compromised'],
  ['contained', 'Contained'],
];

function shorten(value, limit = 18) {
  const text = String(value || 'Unknown');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function edgePath(edge, nodeById) {
  const source = nodeById.get(edge.sourceNodeId);
  const target = nodeById.get(edge.targetNodeId);
  if (!source || !target) return '';
  const sourceX = source.position.x + NODE_WIDTH;
  const sourceY = source.position.y + NODE_HEIGHT / 2;
  const targetX = target.position.x;
  const targetY = target.position.y + NODE_HEIGHT / 2;
  const controlX = sourceX + (targetX - sourceX) / 2;
  return `M ${sourceX} ${sourceY} C ${controlX} ${sourceY}, ${controlX} ${targetY}, ${targetX} ${targetY}`;
}

export function TopologyLegend() {
  return (
    <ul className="digital-twin-legend" aria-label="Topology state legend">
      {LEGEND.map(([state, label]) => <li key={state}><i className={`is-${state}`} aria-hidden="true" />{label}</li>)}
    </ul>
  );
}

function TopologyNode({ node }) {
  const Icon = node.type === 'external' && ['targeted', 'compromised'].includes(node.state)
    ? AlertTriangle
    : NODE_ICONS[node.type] || Server;
  const badge = node.state === 'compromised' ? AlertTriangle : node.state === 'contained' ? CheckCircle : null;
  const Badge = badge;
  return (
    <g
      className={`digital-twin-node is-${node.state}`}
      transform={`translate(${node.position.x} ${node.position.y})`}
      role="img"
      aria-label={`${node.label}, ${node.sublabel}, ${node.state}`}
    >
      <title>{`${node.label}: ${node.sublabel} · ${node.state} · ${node.evidenceCount || 0} supporting alerts`}</title>
      <rect className="digital-twin-node-shell" width={NODE_WIDTH} height={NODE_HEIGHT} rx="10" />
      <Icon className="digital-twin-node-icon" x="50" y="8" width="20" height="20" strokeWidth="1.5" aria-hidden="true" />
      <text className="digital-twin-node-label" x="60" y="44" textAnchor="middle">{shorten(node.label)}</text>
      <text className="digital-twin-node-sublabel" x="60" y="60" textAnchor="middle">{shorten(node.sublabel)}</text>
      {node.state === 'monitoring' && <circle className="digital-twin-monitor-dot" cx="110" cy="10" r="3" aria-hidden="true" />}
      {Badge && <g className="digital-twin-node-badge" aria-hidden="true"><circle cx="112" cy="8" r="10" /><Badge x="106" y="2" width="12" height="12" strokeWidth="1.5" /></g>}
    </g>
  );
}

export default function NetworkTopologyCanvas({ nodes = [], edges = [] }) {
  const [viewport, setViewport] = useState({ zoom:1, x:0, y:0 });
  const [panning, setPanning] = useState(false);
  const dragRef = useRef(null);
  const nodeById = new Map(nodes.map(node => [node.id, node]));

  function zoomBy(delta) {
    setViewport(current => ({ ...current, zoom:Math.min(1.5, Math.max(.75, Number((current.zoom + delta).toFixed(2)))) }));
  }

  function resetViewport() {
    setViewport({ zoom:1, x:0, y:0 });
  }

  function startPan(event) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId:event.pointerId, clientX:event.clientX, clientY:event.clientY, x:viewport.x, y:viewport.y };
    setPanning(true);
  }

  function movePan(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = WIDTH / Math.max(bounds.width, 1);
    setViewport(current => ({
      ...current,
      x:drag.x + (event.clientX - drag.clientX) * ratio,
      y:drag.y + (event.clientY - drag.clientY) * ratio,
    }));
  }

  function endPan(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPanning(false);
  }

  function handleKeyDown(event) {
    const movement = 24;
    if (event.key === '+' || event.key === '=') zoomBy(.15);
    else if (event.key === '-') zoomBy(-.15);
    else if (event.key === '0') resetViewport();
    else if (event.key.startsWith('Arrow')) {
      setViewport(current => ({
        ...current,
        x:current.x + (event.key === 'ArrowLeft' ? movement : event.key === 'ArrowRight' ? -movement : 0),
        y:current.y + (event.key === 'ArrowUp' ? movement : event.key === 'ArrowDown' ? -movement : 0),
      }));
    } else return;
    event.preventDefault();
  }

  return (
    <div className="digital-twin-canvas-wrap">
      <svg
        className={`digital-twin-canvas${panning ? ' is-panning' : ''}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Observed network topology with ${nodes.length} nodes and ${edges.length} evidence links`}
        tabIndex={0}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown = - 0"
        onKeyDown={handleKeyDown}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <title>Observed BMB network topology</title>
        <desc>Use pointer drag or arrow keys to pan. Use plus and minus controls to zoom.</desc>
        <defs>
          <pattern id="digital-twin-dot-grid" width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".7" className="digital-twin-grid-dot" />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} className="digital-twin-canvas-bg" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#digital-twin-dot-grid)" />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          <g className="digital-twin-edges" aria-hidden="true">
            {edges.map(edge => <path key={edge.id} className={`digital-twin-edge is-${edge.state}`} d={edgePath(edge, nodeById)} />)}
          </g>
          <g>{nodes.map(node => <TopologyNode key={node.id} node={node} />)}</g>
        </g>
      </svg>
      <div className="digital-twin-zoom-controls" role="group" aria-label="Topology zoom controls">
        <Button icon={Plus} iconOnly aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(.15)} />
        <Button icon={Minus} iconOnly aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(-.15)} />
        <Button icon={LocateFixed} iconOnly aria-label="Reset topology view" title="Reset topology view" onClick={resetViewport} />
      </div>
    </div>
  );
}
