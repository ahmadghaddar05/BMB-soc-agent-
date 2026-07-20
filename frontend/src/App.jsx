import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Moon, Search, Sun } from 'lucide-react';
import ChatWidget from './components/ChatWidget';
import DataTrustBanner from './components/DataTrustBanner';
import LoginPage from './components/LoginPage';
import PermissionGuard from './components/PermissionGuard';
import RoleAwareSidebar from './components/RoleAwareSidebar';
import RolePreviewSelector from './components/RolePreviewSelector';
import SelectionAssistant from './components/SelectionAssistant';
import { api, setCsrfToken } from './lib/api';
import { getRoleLanding, normalizeRole, ROLE_LABELS, ROLES } from './lib/roles';
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

const PAGE_META = {
  '/dashboard': ['Security Overview', 'Business risk, response performance, and source trust'],
  '/live-monitoring': ['Live Monitoring', 'Newest-first Elastic security activity'],
  '/alerts': ['Technical Triage', 'Prioritize and review security activity'],
  '/incidents': ['Incident Command', 'Correlated attack story and containment'],
  '/ai-triage': ['AI-assisted Triage', 'Evidence-grounded alert prioritization'],
  '/threat-intelligence': ['Entity Intelligence', 'Indicator and entity context'],
  '/assets': ['Asset Intelligence', 'Observed hosts, users, and services'],
  '/vulnerabilities': ['Vulnerabilities', 'Exposure and affected-asset context'],
  '/investigations': ['Investigations', 'Search, select, and document evidence'],
  '/reports': ['Reports', 'Security intelligence and evidence'],
  '/cases': ['Cases', 'Analyst-owned incident workflows'],
  '/approvals': ['Approval Queue', 'Human review for proposed workflow actions'],
  '/responses': ['Safe Response Simulation', 'Non-production response verification and rollback'],
  '/playbooks': ['Playbooks', 'Recommended response procedures'],
  '/integrations': ['Integrations', 'Collector and enrichment connections'],
  '/settings': ['Settings', 'Platform collection and AI-assisted workflow configuration'],
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
  const [theme, setTheme] = useState(() => localStorage.getItem('bmb-theme') || 'dark');
  const [previewRole, setPreviewRole] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const authenticatedRole = normalizeRole(session.user.role);
  const role = import.meta.env.DEV && previewRole ? previewRole : authenticatedRole;
  const landing = getRoleLanding(role);
  const [title, subtitle] = PAGE_META[location.pathname] || PAGE_META[landing];

  useEffect(() => {
    let active = true;
    const loadHealth = () => {
      if (document.visibilityState === 'hidden') return;
      api('/health/dependencies')
        .then(data => { if (active) setPlatformHealth(data); })
        .catch(() => { if (active) setPlatformHealth({ status: 'degraded' }); });
    };
    loadHealth();
    const timer = setInterval(loadHealth, 30000);
    document.addEventListener('visibilitychange', loadHealth);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', loadHealth);
    };
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

  function changePreviewRole(nextRole) {
    setPreviewRole(nextRole);
    setMobileOpen(false);
    navigate(getRoleLanding(nextRole));
  }

  const protect = element => <PermissionGuard role={role}>{element}</PermissionGuard>;

  return (
    <div className="app-shell" data-experience={role}>
      {mobileOpen && <button type="button" className="sidebar-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      <RoleAwareSidebar
        role={role}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        health={platformHealth}
        brand={<BmbLogo compact={collapsed} />}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapsed={() => setCollapsed(value => !value)}
      />

      <section className="app-workspace">
        <header className={`topbar ${role === ROLES.SOC_ANALYST ? '' : 'no-search'}`}>
          <div className="topbar-title">
            <button type="button" className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
            <div><h1>{title}</h1><p>{subtitle}</p></div>
          </div>
          {role === ROLES.SOC_ANALYST && (
            <form className="global-search" onSubmit={submitSearch}>
              <Search size={16} aria-hidden="true" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search IP, user, device, hash, alert ID..." aria-label="Global security search" />
              <kbd>Enter</kbd>
            </form>
          )}
          <div className="topbar-actions">
            <RolePreviewSelector enabled={import.meta.env.DEV} role={role} onChange={changePreviewRole} />
            <button type="button" className="theme-toggle" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button type="button" className="analyst-profile" onClick={onLogout} title={previewRole ? `Sign out · authenticated as ${ROLE_LABELS[authenticatedRole]}` : 'Sign out'}>
              <div><strong>{session.user.username}</strong><small>{previewRole ? `${ROLE_LABELS[role]} preview` : ROLE_LABELS[role]}</small></div>
              <span className="avatar">{session.user.username.slice(0, 2).toUpperCase()}<i /></span>
            </button>
          </div>
        </header>

        <main className="workspace-scroll">
          <DataTrustBanner health={platformHealth} />
          <Suspense fallback={<div className="auth-loading" role="status"><span /><p>Loading workspace…</p></div>}>
            <Routes>
              <Route path="/" element={<Navigate to={landing} replace />} />
              <Route path="/dashboard" element={protect(<Dashboard />)} />
              <Route path="/live-monitoring" element={protect(<LiveMonitoring />)} />
              <Route path="/alerts" element={protect(<Alerts />)} />
              <Route path="/ai-triage" element={protect(<AITriage />)} />
              <Route path="/investigations" element={protect(<Investigations />)} />
              <Route path="/incidents" element={protect(<Incidents />)} />
              <Route path="/cases" element={protect(<Cases />)} />
              <Route path="/approvals" element={protect(<Approvals />)} />
              <Route path="/responses" element={protect(<Responses />)} />
              <Route path="/threat-intelligence" element={protect(<ThreatIntelligence />)} />
              <Route path="/assets" element={protect(<Assets />)} />
              <Route path="/vulnerabilities" element={protect(<Vulnerabilities />)} />
              <Route path="/reports" element={protect(<Reports />)} />
              <Route path="/playbooks" element={protect(<Playbooks />)} />
              <Route path="/integrations" element={protect(<Integrations />)} />
              <Route path="/settings" element={protect(<SettingsPage />)} />
              <Route path="*" element={<Navigate to={landing} replace />} />
            </Routes>
          </Suspense>
        </main>
      </section>
      <ChatWidget role={role} pageContext={{ path: `${location.pathname}${location.search}`, title, subtitle }} />
      <SelectionAssistant />
    </div>
  );
}

function ApiErrorBanner() {
  const [error, setError] = useState(null);
  useEffect(() => {
    const show = event => {
      setError(event.detail);
      window.clearTimeout(show.timer);
      show.timer = window.setTimeout(() => setError(null), 7000);
    };
    window.addEventListener('bmb-api-error', show);
    return () => {
      window.removeEventListener('bmb-api-error', show);
      window.clearTimeout(show.timer);
    };
  }, []);
  if (!error || error.status === 401) return null;
  return <div className="api-error-banner" role="alert"><span>{error.message}</span>{error.requestId && <small>Request {error.requestId}</small>}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>;
}

function AuthenticatedApp() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api('/auth/session')
      .then(value => {
        if (active) {
          setCsrfToken(value.csrf);
          setSession(value);
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    const expired = () => {
      setCsrfToken(null);
      setSession(null);
    };
    window.addEventListener('bmb-auth-expired', expired);
    return () => {
      active = false;
      window.removeEventListener('bmb-auth-expired', expired);
    };
  }, []);

  async function logout() {
    try { await api('/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    setCsrfToken(null);
    setSession(null);
  }

  if (loading) return <div className="auth-loading"><span /><p>Checking secure session…</p></div>;
  if (!session) return <><LoginPage onAuthenticated={value => { setCsrfToken(value.csrf); setSession(value); }} /><ApiErrorBanner /></>;
  return <BrowserRouter><Shell session={session} onLogout={logout} /><ApiErrorBanner /></BrowserRouter>;
}

export default function App() {
  return <AuthenticatedApp />;
}
