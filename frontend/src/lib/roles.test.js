import { describe, expect, it } from 'vitest';
import {
  canAccessRoute, getRoleLanding, getRoleNavigation, normalizeRole, ROLE_LABELS, ROLES,
} from './roles';

describe('role-aware presentation model', () => {
  it('normalizes supported server role aliases without granting unknown users administrator access', () => {
    expect(normalizeRole('admin')).toBe(ROLES.ADMINISTRATOR);
    expect(normalizeRole('analyst')).toBe(ROLES.SOC_ANALYST);
    expect(normalizeRole('CISO')).toBe(ROLES.EXECUTIVE);
    expect(normalizeRole('unrecognized-role')).toBe(ROLES.EXECUTIVE);
  });

  it('assigns a distinct landing page and short navigation to each experience', () => {
    expect(getRoleLanding(ROLES.EXECUTIVE)).toBe('/dashboard');
    expect(getRoleLanding(ROLES.SOC_ANALYST)).toBe('/live-monitoring');
    expect(getRoleLanding(ROLES.ADMINISTRATOR)).toBe('/integrations');

    const executiveLinks = getRoleNavigation(ROLES.EXECUTIVE).flatMap(group => group.items.map(item => item.to));
    const analystLinks = getRoleNavigation(ROLES.SOC_ANALYST).flatMap(group => group.items.map(item => item.to));
    const adminLinks = getRoleNavigation(ROLES.ADMINISTRATOR).flatMap(group => group.items.map(item => item.to));

    expect(executiveLinks).toEqual(['/dashboard', '/reports']);
    expect(analystLinks).toContain('/alerts');
    expect(analystLinks).not.toContain('/settings');
    expect(adminLinks).toEqual([
      '/integrations', '/collector-health', '/ai-configuration', '/users-access',
      '/audit-governance', '/data-retention', '/reports', '/settings',
    ]);
    expect(ROLE_LABELS[ROLES.SOC_ANALYST]).toBe('SOC Analyst');
  });

  it('keeps technical and configuration routes out of unauthorized experiences', () => {
    expect(canAccessRoute(ROLES.EXECUTIVE, '/alerts')).toBe(false);
    expect(canAccessRoute(ROLES.EXECUTIVE, '/incidents')).toBe(true);
    expect(canAccessRoute(ROLES.SOC_ANALYST, '/settings')).toBe(false);
    expect(canAccessRoute(ROLES.SOC_ANALYST, '/responses')).toBe(true);
    expect(canAccessRoute(ROLES.ADMINISTRATOR, '/settings')).toBe(true);
    expect(canAccessRoute(ROLES.ADMINISTRATOR, '/collector-health')).toBe(true);
    expect(canAccessRoute(ROLES.ADMINISTRATOR, '/alerts')).toBe(false);
  });
});
