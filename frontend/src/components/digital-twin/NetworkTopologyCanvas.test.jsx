import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NetworkTopologyCanvas, { TopologyLegend } from './NetworkTopologyCanvas';

const nodes = [
  { id:'source', label:'External source', sublabel:'203.0.113.44', type:'external', state:'targeted', evidenceCount:4, position:{ x:48, y:100 } },
  { id:'server', label:'Web server', sublabel:'WEB-SRV01', type:'server', state:'compromised', evidenceCount:4, position:{ x:360, y:100 } },
  { id:'database', label:'Database', sublabel:'CUSTOMER-DB', type:'database', state:'contained', evidenceCount:2, position:{ x:744, y:100 } },
];

describe('NetworkTopologyCanvas', () => {
  it('renders accessible nodes, routed edge states, and shared controls', () => {
    const html = renderToStaticMarkup(<NetworkTopologyCanvas nodes={nodes} edges={[
      { id:'active', sourceNodeId:'source', targetNodeId:'server', state:'active-traversal' },
      { id:'complete', sourceNodeId:'server', targetNodeId:'database', state:'traversed' },
    ]} />);
    expect(html).toContain('Observed network topology with 3 nodes and 2 evidence links');
    expect(html).toContain('digital-twin-edge is-active-traversal');
    expect(html).toContain('digital-twin-edge is-traversed');
    expect(html).toContain('digital-twin-node is-targeted');
    expect(html).toContain('digital-twin-node is-compromised');
    expect(html).toContain('digital-twin-node is-contained');
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Reset topology view"');
    expect(html).toContain('aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown = - 0"');
  });

  it('uses one compact five-state legend', () => {
    const html = renderToStaticMarkup(<TopologyLegend />);
    expect(html).toContain('Topology state legend');
    ['Idle', 'Monitoring', 'Targeted', 'Compromised', 'Contained'].forEach(label => expect(html).toContain(label));
  });

  it('updates the shared viewport through the zoom and reset controls', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<NetworkTopologyCanvas nodes={nodes} edges={[]} />));
    const viewport = () => container.querySelector('.digital-twin-canvas > g[transform]');
    expect(viewport().getAttribute('transform')).toContain('scale(1)');
    await act(async () => container.querySelector('[aria-label="Zoom in"]').click());
    expect(viewport().getAttribute('transform')).toContain('scale(1.15)');
    const canvas = container.querySelector('.digital-twin-canvas');
    await act(async () => canvas.dispatchEvent(new window.KeyboardEvent('keydown', {
      key:'ArrowRight', bubbles:true, cancelable:true,
    })));
    expect(viewport().getAttribute('transform')).toContain('translate(-24 0)');
    await act(async () => container.querySelector('[aria-label="Reset topology view"]').click());
    expect(viewport().getAttribute('transform')).toBe('translate(0 0) scale(1)');
    await act(async () => root.unmount());
    container.remove();
  });
});
