import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShieldAlert } from 'lucide-react';
import {
  Button, Card, ConfidenceGauge, EmptyState, LiveIndicator, SegmentedControl,
  RankedBarList, SeverityBadge, SkeletonLoader, StatusChip, Timeline, UnderlineTabs,
} from './index';

describe('BMB shared product components', () => {
  it('renders the canonical card structure without a page-specific variant', () => {
    const html = renderToStaticMarkup(<Card title="Evidence" caption="Observed activity" compact><p>Stored record</p></Card>);
    expect(html).toContain('ui-card ui-card-compact');
    expect(html).toContain('<h2>Evidence</h2>');
    expect(html).toContain('Observed activity');
  });

  it('uses shared semantic severity and status primitives', () => {
    const html = renderToStaticMarkup(<><SeverityBadge severity="critical" /><StatusChip status="active">Live</StatusChip><LiveIndicator /></>);
    expect(html).toContain('ui-severity-critical');
    expect(html).toContain('ui-status-active');
    expect(html).toContain('ui-live-indicator');
  });

  it('renders accessible controls and restrained empty/loading states', () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<><Button variant="primary">Review</Button><SegmentedControl label="Range" value="24h" onChange={onChange} options={[{ value:'24h', label:'24 hours' }]} /><EmptyState icon={ShieldAlert} message="No data in this range" action={<a href="#filters">Adjust filters</a>} /><SkeletonLoader lines={2} /></>);
    expect(html).toContain('ui-button-primary');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('No data in this range');
    expect(html.match(/class="ui-skeleton"/g)).toHaveLength(2);
  });

  it('provides one reusable timeline language for monitoring, reasoning, and cases', () => {
    const html = renderToStaticMarkup(<Timeline items={[{ id:'one', title:'Evidence collected', detail:'Two matching records', meta:'2m ago', expandedContent:<p>Stored record</p> }]} />);
    expect(html).toContain('ui-timeline');
    expect(html).toContain('Evidence collected');
    expect(html).toContain('Two matching records');
    expect(html).toContain('Recorded details');
  });

  it('renders shared AI confidence and underline-tab controls', () => {
    const html = renderToStaticMarkup(<><ConfidenceGauge value={84} label="Needs investigation" /><UnderlineTabs value="overview" onChange={vi.fn()} options={[{ value:'overview', label:'Overview' }, { value:'evidence', label:'Evidence' }]} /></>);
    expect(html).toContain('ui-confidence-confident');
    expect(html).toContain('84%');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
  });

  it('renders one reusable ranked-bar pattern for analytics evidence', () => {
    const html = renderToStaticMarkup(<RankedBarList data={[{ name:'198.51.100.24', count:18, high_risk:7 }]} ariaLabel="Top source IPs" />);
    expect(html).toContain('ui-ranked-list');
    expect(html).toContain('198.51.100.24');
    expect(html).toContain('7 high risk');
  });
});
