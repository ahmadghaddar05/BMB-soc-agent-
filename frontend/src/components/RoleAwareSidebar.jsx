import { NavLink } from 'react-router-dom';
import {
  AlertTriangle, BriefcaseBusiness, ChevronLeft, FileText, Globe2, LayoutDashboard,
  RadioTower, Search, Server, Settings, ShieldAlert, ShieldCheck, ShieldOff, X,
} from 'lucide-react';
import { getRoleNavigation } from '../lib/roles';

const ICONS = {
  dashboard: LayoutDashboard,
  monitoring: RadioTower,
  triage: ShieldAlert,
  investigations: Search,
  incidents: AlertTriangle,
  cases: BriefcaseBusiness,
  approvals: ShieldCheck,
  response: ShieldOff,
  assets: Server,
  intelligence: Globe2,
  vulnerabilities: ShieldAlert,
  integrations: Server,
  reports: FileText,
  settings: Settings,
};

export default function RoleAwareSidebar({ role, collapsed, mobileOpen, health, brand, onCloseMobile, onToggleCollapsed }) {
  const groups = getRoleNavigation(role);
  return (
    <aside className={`soc-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
      <div className="sidebar-brand-row">
        {brand}
        <button type="button" className="icon-button sidebar-mobile-close" onClick={onCloseMobile} aria-label="Close navigation"><X size={18} /></button>
      </div>

      <nav className="sidebar-nav sidebar-nav-dense" aria-label="Primary navigation">
        {groups.map(group => <div className="nav-group" key={group.label}>
          {!collapsed && <p className="nav-group-label">{group.label}</p>}
          {group.items.map(item => {
            const Icon = ICONS[item.icon] || ShieldAlert;
            return (
              <NavLink key={item.to} to={item.to} title={collapsed ? item.label : undefined} onClick={onCloseMobile} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <Icon className="nav-icon" aria-hidden="true" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </div>)}
      </nav>

      <div className="sidebar-footer">
        <div className="agent-status" title="Live dependency health">
          <span className={`status-orbit ${health?.status === 'ok' ? '' : 'degraded'}`}><span /></span>
          {!collapsed && <div><strong>{health?.status === 'ok' ? 'Platform healthy' : health ? 'Platform degraded' : 'Checking platform'}</strong><small>{health?.source ? `Source: ${health.source}` : 'Verifying dependencies'}</small></div>}
        </div>
        <button type="button" className="collapse-button" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}><ChevronLeft className={collapsed ? 'rotate-180' : ''} size={16} />{!collapsed && <span>Collapse</span>}</button>
      </div>
    </aside>
  );
}
