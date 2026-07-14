import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Bell, Blocks, BookOpenCheck, BrainCircuit, BriefcaseBusiness,
  ChevronLeft, FileText, Globe2, LayoutDashboard, Menu, Network, Search,
  Server, Settings, ShieldAlert, Sparkles, X,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Alerts from './pages/Alerts';
import Incidents from './pages/Incidents';
import SettingsPage from './pages/Settings';
import Reports from './pages/Reports';
import AITriage from './pages/AITriage';
import ThreatIntelligence from './pages/ThreatIntelligence';
import Assets from './pages/Assets';
import Vulnerabilities from './pages/Vulnerabilities';
import Investigations from './pages/Investigations';
import Playbooks from './pages/Playbooks';
import Integrations from './pages/Integrations';
import Cases from './pages/Cases';
import ChatWidget from './components/ChatWidget';
import './index.css';

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
  { to: '/incidents', icon: AlertTriangle, label: 'Incidents' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/ai-triage', icon: BrainCircuit, label: 'AI Triage' },
  { to: '/threat-intelligence', icon: Globe2, label: 'Threat Intelligence' },
  { to: '/assets', icon: Server, label: 'Assets' },
  { to: '/vulnerabilities', icon: ShieldAlert, label: 'Vulnerabilities' },
  { to: '/investigations', icon: Search, label: 'Investigations' },
  { to: '/reports', icon: FileText, label: 'Reports' },
  { to: '/cases', icon: BriefcaseBusiness, label: 'Cases' },
  { to: '/playbooks', icon: BookOpenCheck, label: 'Playbooks' },
  { to: '/integrations', icon: Blocks, label: 'Integrations' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const PAGE_META = {
  '/dashboard': ['BMB AI-SOC', 'Executive Security Overview'],
  '/alerts': ['Alert Triage Workspace', 'Investigate and respond to security activity'],
  '/incidents': ['Incident Command', 'Correlated attack story and containment'],
  '/ai-triage': ['AI Triage', 'Model-assisted alert prioritization'],
  '/threat-intelligence': ['Threat Intelligence', 'Indicator and entity intelligence'],
  '/assets': ['Asset Intelligence', 'Observed hosts, users, and services'],
  '/vulnerabilities': ['Vulnerabilities', 'Exposure and affected-asset context'],
  '/investigations': ['Investigations', 'Cross-entity security search'],
  '/reports': ['Reports', 'Security intelligence and evidence'],
  '/cases': ['Cases', 'Analyst-owned incident workflows'],
  '/playbooks': ['Playbooks', 'Recommended response procedures'],
  '/integrations': ['Integrations', 'Collector and enrichment connections'],
  '/settings': ['Settings', 'Collector and AI configuration'],
};

function BmbLogo({ compact = false }) {
  return (
    <div className="bmb-brand" aria-label="BMB">
      <img className={compact ? 'bmb-logo-symbol' : 'bmb-logo-full'} src={compact ? '/bmb-symbol.svg' : '/bmb-logo.svg'} alt="BMB" />
    </div>
  );
}

function Shell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [title, subtitle] = PAGE_META[location.pathname] || PAGE_META['/dashboard'];

  function submitSearch(event) {
    event.preventDefault();
    const value = search.trim();
    if (!value) return;
    navigate(`/alerts?search=${encodeURIComponent(value)}`);
    setMobileOpen(false);
  }

  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      <aside className={`soc-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <div className="sidebar-brand-row">
          <BmbLogo compact={collapsed} />
          <button className="icon-button sidebar-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>

        <nav className="sidebar-nav sidebar-nav-dense" aria-label="Primary navigation">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} title={collapsed ? label : undefined} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon className="nav-icon" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && <div className="sidebar-mini-brand"><BmbLogo /><span>AI-SOC</span></div>}
          <div className="agent-status" title="Collector online"><span className="status-orbit"><span /></span>{!collapsed && <div><strong>Agent online</strong><small>Monitoring Elastic</small></div>}</div>
          <button className="collapse-button" onClick={() => setCollapsed(value => !value)}><ChevronLeft className={collapsed ? 'rotate-180' : ''} size={16} />{!collapsed && <span>Collapse</span>}</button>
        </div>
      </aside>

      <section className="app-workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
            <div><h1>{title}</h1><p>{subtitle}</p></div>
          </div>
          <form className="global-search" onSubmit={submitSearch}>
            <Search size={16} />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search IP, user, device, hash, alert ID..." aria-label="Global security search" />
            <kbd>Enter</kbd>
          </form>
          <div className="topbar-actions">
            <button className="ask-ai-button" onClick={() => window.dispatchEvent(new CustomEvent('open-soc-assistant'))}><Sparkles size={15} /><span>Ask AI Analyst</span></button>
            <button className="icon-button notification-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(value => !value)}><Bell size={18} /><span /></button>
            <div className="analyst-profile"><div><strong>Analyst</strong><small>SOC Director</small></div><span className="avatar">AM<i /></span></div>
          </div>
        </header>
        {notificationsOpen && <div className="notification-popover"><div><strong>Security notifications</strong><button onClick={() => setNotificationsOpen(false)}><X /></button></div><button onClick={() => { navigate('/alerts?severity=critical'); setNotificationsOpen(false); }}><ShieldAlert /><span><strong>Review critical alerts</strong><small>Open the current critical investigation queue.</small></span></button><button onClick={() => { navigate('/incidents'); setNotificationsOpen(false); }}><AlertTriangle /><span><strong>Open incidents</strong><small>Continue correlated incident response.</small></span></button></div>}

        <main className="workspace-scroll">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/ai-triage" element={<AITriage />} />
            <Route path="/investigations" element={<Investigations />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/threat-intelligence" element={<ThreatIntelligence />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/vulnerabilities" element={<Vulnerabilities />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/playbooks" element={<Playbooks />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </section>
      <ChatWidget />
    </div>
  );
}

export default function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
