import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Bell, Blocks, BookOpenCheck, BrainCircuit, BriefcaseBusiness,
  ChevronLeft, FileText, Globe2, LayoutDashboard, Menu, Network, Search,
  Server, Settings, ShieldAlert, ShieldCheck, Sparkles, X,
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
import Approvals from './pages/Approvals';
import ChatWidget from './components/ChatWidget';
import LoginPage from './components/LoginPage';
import { api, setCsrfToken } from './lib/api';
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
  { to: '/approvals', icon: ShieldCheck, label: 'Approvals' },
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
  '/approvals': ['Approval Queue', 'Controlled AI workflow actions'],
  '/playbooks': ['Playbooks', 'Recommended response procedures'],
  '/integrations': ['Integrations', 'Collector and enrichment connections'],
  '/settings': ['Settings', 'Collector and AI configuration'],
};

function BmbLogo({ compact = false }) {
  return (
    <div className={`bmb-brand ${compact ? 'is-compact' : ''}`} aria-label="BMB">
      <span className="bmb-logo-original" aria-hidden="true" />
    </div>
  );
}

function Shell({ session, onLogout }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [platformHealth, setPlatformHealth] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [title, subtitle] = PAGE_META[location.pathname] || PAGE_META['/dashboard'];

  useEffect(() => {
    let active = true;
    const loadHealth = () => api('/health/dependencies').then(data => { if (active) setPlatformHealth(data); }).catch(() => { if (active) setPlatformHealth({ status:'degraded' }); });
    loadHealth();
    const timer = setInterval(loadHealth, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);

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
          <div className="agent-status" title="Live dependency health"><span className={`status-orbit ${platformHealth?.status === 'ok' ? '' : 'degraded'}`}><span /></span>{!collapsed && <div><strong>{platformHealth?.status === 'ok' ? 'Platform healthy' : platformHealth ? 'Platform degraded' : 'Checking platform'}</strong><small>{platformHealth?.source ? `Source: ${platformHealth.source}` : 'Verifying dependencies'}</small></div>}</div>
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
            <button className="analyst-profile" onClick={onLogout} title="Sign out"><div><strong>{session.user.username}</strong><small>{session.user.role}</small></div><span className="avatar">{session.user.username.slice(0,2).toUpperCase()}<i /></span></button>
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
            <Route path="/approvals" element={<Approvals />} />
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

function ApiErrorBanner() {
  const [error, setError] = useState(null);
  useEffect(() => {
    const show = event => { setError(event.detail); window.clearTimeout(show.timer); show.timer = window.setTimeout(() => setError(null), 7000); };
    window.addEventListener('bmb-api-error', show);
    return () => { window.removeEventListener('bmb-api-error', show); window.clearTimeout(show.timer); };
  }, []);
  if (!error || error.status === 401) return null;
  return <div className="api-error-banner" role="alert"><span>{error.message}</span>{error.requestId && <small>Request {error.requestId}</small>}<button onClick={() => setError(null)}>×</button></div>;
}

function AuthenticatedApp() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api('/auth/session').then(value => { if (active) { setCsrfToken(value.csrf); setSession(value); } }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    const expired = () => { setCsrfToken(null); setSession(null); };
    window.addEventListener('bmb-auth-expired', expired);
    return () => { active = false; window.removeEventListener('bmb-auth-expired', expired); };
  }, []);

  async function logout() {
    try { await api('/auth/logout', { method:'POST', body:'{}' }); } catch {}
    setCsrfToken(null);
    setSession(null);
  }

  if (loading) return <div className="auth-loading"><span /><p>Checking secure session…</p></div>;
  if (!session) return <><LoginPage onAuthenticated={value => { setCsrfToken(value.csrf); setSession(value); }} /><ApiErrorBanner /></>;
  return <BrowserRouter><Shell session={session} onLogout={logout} /><ApiErrorBanner /></BrowserRouter>;
}

export default function App() { return <AuthenticatedApp />; }
