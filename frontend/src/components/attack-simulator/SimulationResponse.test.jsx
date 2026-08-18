import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SimulationResponse from './SimulationResponse';

describe('simulation response', () => {
  it('shows a processing state without inventing recommendations', () => {
    const html = renderToStaticMarkup(<SimulationResponse response={{
      confidence:null, verdict:'Analyzing scenario', actions:[], complete:false, summary:null,
    }} />);
    expect(html).toContain('AI Recommended Response');
    expect(html).toContain('Analyzing scenario');
    expect(html).toContain('Loading content');
    expect(html).not.toContain('Simulation Complete');
  });

  it('shows progressively derived actions and the final measured outcome', () => {
    const html = renderToStaticMarkup(<SimulationResponse response={{
      confidence:98,
      verdict:'Attack contained',
      actions:['Preserve evidence', 'Suspend the test identity'],
      complete:true,
      summary:'Contained in 17.5s · 1 system affected · 0 data loss',
    }} />);
    expect(html).toContain('98%');
    expect(html).toContain('Preserve evidence');
    expect(html).toContain('Suspend the test identity');
    expect(html).toContain('Simulation Complete');
    expect(html).toContain('Contained in 17.5s');
  });
});
