import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BriefcaseBusiness, ChevronLeft, FileText, Globe2, LayoutDashboard,
  Menu, Moon, RadioTower, Search, Server, Settings, ShieldAlert, ShieldCheck, ShieldOff,
  Sparkles, Sun, X,
} from 'lucide-react';
import ChatWidget from './components/ChatWidget';
import SelectionAssistant from './components/SelectionAssistant';
import LoginPage from './components/LoginPage';
import { api, setCsrfToken } from './lib/api';
import './index.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const LiveMonitoring = lazy(() => import('./pages/LiveMonitoring'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Incidents = lazy(() => import('./pages/Incidents'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Reports = lazy(() => import('./pages/Reports'));
const AITriage = lazy(() => import('./pages/AITriage'));
const ThreatIntelligence = lazy(() => import('./pages/ThreatIntelligence'));
const Assets = lazy(() => import('./pages/Assets'));
const Vulnerabilities = lazy(() => import('./pages/Vulnerabilities'));
const Investigations = lazy(() => import('./pages/Investigations'));
const Playbooks = lazy(() => import('./pages/Playbooks'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Cases = lazy(() => import('./pages/Cases'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Responses = lazy(() => import('./pages/Responses'));

const NAV_GROUPS = [
  { label:'Executive', items:[
    { to:'/dashboard', icon:LayoutDashboard, label:'Overview' },
  ] },
  { label:'Operations', items:[
    { to:'/live-monitoring', icon:RadioTower, label:'Live Monitoring' },
    { to:'/incidents', icon:AlertTriangle, label:'Incidents' },
    { to:'/alerts', icon:ShieldAlert, label:'Technical Triage' },
    { to:'/investigations', icon:Search, label:'Investigations' },
    { to:'/cases', icon:BriefcaseBusiness, label:'Cases' },
    { to:'/approvals', icon:ShieldCheck, label:'Approvals' },
    { to:'/responses', icon:ShieldOff, label:'Response Lab' },
  ] },
  { label:'Intelligence', items:[
    { to:'/assets', icon:Server, label:'Assets' },
    { to:'/threat-intelligence', icon:Globe2, label:'Threat Intelligence' },
    { to:'/vulnerabilities', icon:ShieldAlert, label:'Vulnerabilities' },
  ] },
  { label:'Administration', items:[
    { to:'/reports', icon:FileText, label:'Reports' },
    { to:'/settings', icon:Settings, label:'Settings' },
  ] },
];

const PAGE_META = {
  '/dashboard': ['BMB AI-SOC', 'Executive Security Overview'],
  '/live-monitoring': ['Live Monitoring', 'Auto-refreshed Elastic security activity'],
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
  '/responses': ['Simulated Response Center', 'Approval-gated response verification and rollback'],
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
  const [platformHealth, setPlatformHealth] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('bmb-theme') || 'light');
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('bmb-theme', theme);
  }, [theme]);

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
          {NAV_GROUPS.map(group => <div className="nav-group" key={group.label}>
            {!collapsed && <p className="nav-group-label">{group.label}</p>}
            {group.items.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} title={collapsed ? label : undefined} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <Icon className="nav-icon" />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            ))}
          </div>)}
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
            <button className="theme-toggle" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button className="ask-ai-button" onClick={() => window.dispatchEvent(new CustomEvent('open-soc-assistant'))}><Sparkles size={15} /><span>Ask AI Analyst</span></button>
            <button className="analyst-profile" onClick={onLogout} title="Sign out"><div><strong>{session.user.username}</strong><small>{session.user.role}</small></div><span className="avatar">{session.user.username.slice(0,2).toUpperCase()}<i /></span></button>
          </div>
        </header>

        <main className="workspace-scroll">
          <Suspense fallback={<div className="auth-loading" role="status"><span /><p>Loading workspace…</p></div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/live-monitoring" element={<LiveMonitoring />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/ai-triage" element={<AITriage />} />
            <Route path="/investigations" element={<Investigations />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/responses" element={<Responses />} />
            <Route path="/threat-intelligence" element={<ThreatIntelligence />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/vulnerabilities" element={<Vulnerabilities />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/playbooks" element={<Playbooks />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </Suspense>
        </main>
      </section>
      <ChatWidget />
      <SelectionAssistant />
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
