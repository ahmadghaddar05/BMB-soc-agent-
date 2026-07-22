import { describe, expect, it } from 'vitest';
import { activityTitle, businessAssetLabel, operationWin, severityOf, technicalLink } from './executive';

describe('executive security adapters', () => {
  it('keeps a specific detection name unchanged', () => {
    expect(activityTitle({ rule_desc:'Suspicious OAuth consent grant' })).toBe('Suspicious OAuth consent grant');
  });

  it('replaces a generic critical label with the evidence-backed activity type', () => {
    expect(activityTitle({
      rule_desc:'Critical Security Event Detected',
      event_action:'credential-dumping',
      process:'lsass.exe',
    })).toBe('Credential dumping attempt');
  });

  it('names policy violations directly without inventing malware', () => {
    expect(activityTitle({
      rule_desc:'Critical Security Event Detected',
      event_action:'unauthorized-game-launch',
    })).toBe('Unauthorized game application launched');
    expect(activityTitle({
      rule_desc:'Security Event Detected',
      event_action:'prohibited-website-access',
    })).toBe('Prohibited website accessed');
  });

  it('prioritizes a successful login after brute force over the precursor label', () => {
    expect(activityTitle({ rule_desc:'Security Event Detected', event_action:'login-success-after-brute-force' }))
      .toBe('Successful login following brute-force activity');
  });

  it('keeps dataset fallbacks factual without contradicting the severity badge', () => {
    expect(activityTitle({ rule_desc:'Security Event Detected', event_dataset:'database.audit', source_severity:'medium' }))
      .toBe('Database security activity detected');
  });

  it('uses Elastic source severity before the legacy level fallback', () => {
    expect(severityOf({ source_severity:'high', rule_level:12 })).toBe('high');
    expect(severityOf({ rule_level:12 })).toBe('critical');
  });

  it('never promotes a raw IP address as an executive asset name', () => {
    expect(businessAssetLabel({ name:'198.51.100.24' })).toBe('Unmapped infrastructure');
    expect(businessAssetLabel({ name:'DC01' })).toBe('Identity & Authentication Service');
  });

  it('describes simulated-response workflow without claiming containment', () => {
    const win = operationWin({ operation_type:'request_simulated_response', source_type:'case', source_id:'7' });
    expect(win.summary).toContain('No external system changed');
    expect(win.summary).not.toMatch(/isolated|contained|mitigated/i);
  });

  it('routes drawer handoffs to the correct technical workspace', () => {
    expect(technicalLink({ type:'risk-summary', id:'30-day-risks' }, {})).toBe('/incidents?status=open');
    expect(technicalLink({ type:'automation', id:'42' }, { source_type:'case', source_id:'7' }))
      .toBe('/incidents?incident=7');
    expect(technicalLink({ type:'asset', id:'DB01' }, { window_days:30 })).toBe('/alerts?time_range=43200&search=DB01');
  });
});
