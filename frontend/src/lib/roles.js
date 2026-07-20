export const ROLES = Object.freeze({
  EXECUTIVE: 'executive',
  SOC_ANALYST: 'soc_analyst',
  ADMINISTRATOR: 'administrator',
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.EXECUTIVE]: 'Executive',
  [ROLES.SOC_ANALYST]: 'SOC Analyst',
  [ROLES.ADMINISTRATOR]: 'Security Administrator',
});

const ROLE_ALIASES = Object.freeze({
  executive: ROLES.EXECUTIVE,
  ciso: ROLES.EXECUTIVE,
  analyst: ROLES.SOC_ANALYST,
  soc: ROLES.SOC_ANALYST,
  soc_analyst: ROLES.SOC_ANALYST,
  'soc-analyst': ROLES.SOC_ANALYST,
  admin: ROLES.ADMINISTRATOR,
  administrator: ROLES.ADMINISTRATOR,
  security_administrator: ROLES.ADMINISTRATOR,
});

export const ROLE_LANDINGS = Object.freeze({
  [ROLES.EXECUTIVE]: '/dashboard',
  [ROLES.SOC_ANALYST]: '/live-monitoring',
  [ROLES.ADMINISTRATOR]: '/integrations',
});

export const ROLE_NAVIGATION = Object.freeze({
  [ROLES.EXECUTIVE]: [
    {
      label: 'Executive',
      items: [
        { to: '/dashboard', icon: 'dashboard', label: 'Overview' },
        { to: '/reports', icon: 'reports', label: 'Executive Reports' },
      ],
    },
  ],
  [ROLES.SOC_ANALYST]: [
    {
      label: 'Security Operations',
      items: [
        { to: '/live-monitoring', icon: 'monitoring', label: 'Monitoring' },
        { to: '/alerts', icon: 'triage', label: 'Triage' },
        { to: '/investigations', icon: 'investigations', label: 'Investigations' },
        { to: '/incidents', icon: 'incidents', label: 'Incidents' },
        { to: '/cases', icon: 'cases', label: 'Cases' },
        { to: '/approvals', icon: 'approvals', label: 'Approvals' },
        { to: '/responses', icon: 'response', label: 'Safe Response Simulation' },
      ],
    },
    {
      label: 'Security Context',
      items: [
        { to: '/assets', icon: 'assets', label: 'Assets' },
        { to: '/threat-intelligence', icon: 'intelligence', label: 'Entity Intelligence' },
        { to: '/vulnerabilities', icon: 'vulnerabilities', label: 'Vulnerabilities' },
      ],
    },
  ],
  [ROLES.ADMINISTRATOR]: [
    {
      label: 'Administration',
      items: [
        { to: '/integrations', icon: 'integrations', label: 'Integrations' },
        { to: '/reports', icon: 'reports', label: 'Reports' },
        { to: '/settings', icon: 'settings', label: 'Settings' },
      ],
    },
  ],
});

export const ROUTE_ACCESS = Object.freeze({
  '/dashboard': [ROLES.EXECUTIVE, ROLES.ADMINISTRATOR],
  '/live-monitoring': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/alerts': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/ai-triage': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/investigations': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/incidents': [ROLES.EXECUTIVE, ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/cases': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/approvals': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/responses': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/threat-intelligence': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/assets': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/vulnerabilities': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/reports': [ROLES.EXECUTIVE, ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/playbooks': [ROLES.SOC_ANALYST, ROLES.ADMINISTRATOR],
  '/integrations': [ROLES.ADMINISTRATOR],
  '/settings': [ROLES.ADMINISTRATOR],
});

export function normalizeRole(role) {
  return ROLE_ALIASES[String(role || '').trim().toLowerCase()] || ROLES.EXECUTIVE;
}

export function getRoleLanding(role) {
  return ROLE_LANDINGS[normalizeRole(role)];
}

export function getRoleNavigation(role) {
  return ROLE_NAVIGATION[normalizeRole(role)] || [];
}

export function canAccessRoute(role, pathname) {
  const allowed = ROUTE_ACCESS[pathname];
  return Boolean(allowed?.includes(normalizeRole(role)));
}
