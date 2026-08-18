import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MitreKillChain from './MitreKillChain';

describe('MITRE kill chain', () => {
  it('renders accessible stages with active, completed, blocked, and cut paths', () => {
    const html = renderToStaticMarkup(<MitreKillChain stages={[
      { id:'one', tacticName:'Initial Access', techniqueId:'T1190', state:'completed', cut:false },
      { id:'two', tacticName:'Lateral Movement', techniqueId:'T1021', state:'blocked', cut:false },
      { id:'three', tacticName:'Impact', techniqueId:'T1486', state:'upcoming', cut:true },
    ]} />);
    expect(html).toContain('aria-label="MITRE ATT&amp;CK simulation progress"');
    expect(html).toContain('Initial Access, completed');
    expect(html).toContain('Lateral Movement, blocked');
    expect(html).toContain('Impact, upcoming');
    expect(html).toContain('mitre-stage-link is-traversed');
    expect(html).toContain('mitre-stage-link is-cut');
  });
});
