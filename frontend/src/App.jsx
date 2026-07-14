import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Bell, ChevronLeft, FileText, LayoutDashboard,
  Menu, Network, Search, Settings, Sparkles, X,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Alerts from './pages/Alerts';
import Incidents from './pages/Incidents';
import Pivot from './pages/Pivot';
import SettingsPage from './pages/Settings';
import Reports from './pages/Reports';
import ChatWidget from './components/ChatWidget';
import './index.css';

const NAV_GROUPS = [
  {
    label: 'General',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
      { to: '/incidents', icon: AlertTriangle, label: 'Incidents' },
      { to: '/alerts', icon: Bell, label: 'Alerts' },
    ],
  },
  {
    label: 'Investigation',
    items: [
      { to: '/pivot', icon: Network, label: 'IOC Pivot' },
      { to: '/reports', icon: FileText, label: 'Reports' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

const PAGE_META = {
  '/dashboard': ['BMB AI-SOC', 'Executive Security Overview'],
  '/alerts': ['Security Alerts', 'Grouped and individual activity'],
  '/incidents': ['Incidents', 'Correlated investigations'],
  '/pivot': ['IOC Pivot', 'Search observables and entities'],
  '/reports': ['Reports', 'Security intelligence and evidence'],
  '/settings': ['Settings', 'Collector and AI configuration'],
};

function BmbLogo({ compact = false }) {
  return (
    <div className="bmb-brand" aria-label="BMB AI-SOC">
      <span className="bmb-mark" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span className="bmb-wordmark">bmb</span>}
    </div>
  );
}

function Shell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
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

  function openAssistant() {
    window.dispatchEvent(new CustomEvent('open-soc-assistant'));
  }

  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}

      <aside className={`soc-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <div className="sidebar-brand-row">
          <BmbLogo compact={collapsed} />
          <button className="icon-button sidebar-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {NAV_GROUPS.map(group => (
            <div className="nav-group" key={group.label}>
              {!collapsed && <p className="nav-group-label">{group.label}</p>}
              {group.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={collapsed ? label : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <Icon className="nav-icon" />
                  {!collapsed && <span>{label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="agent-status" title="Collector online">
            <span className="status-orbit"><span /></span>
            {!collapsed && <div><strong>Agent online</strong><small>Monitoring Elastic</small></div>}
          </div>
          <button className="collapse-button" onClick={() => setCollapsed(value => !value)}>
            <ChevronLeft className={collapsed ? 'rotate-180' : ''} size={16} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <section className="app-workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu size={19} />
            </button>
            <div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>

          <form className="global-search" onSubmit={submitSearch}>
            <Search size={16} />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search incidents, assets, indicators..."
              aria-label="Global security search"
            />
            <kbd>Enter</kbd>
          </form>

          <div className="topbar-actions">
            <button className="ask-ai-button" onClick={openAssistant}>
              <Sparkles size={15} />
              <span>Ask AI Analyst</span>
            </button>
            <button className="icon-button notification-button" aria-label="Notifications">
              <Bell size={18} /><span />
            </button>
            <div className="analyst-profile">
              <div><strong>Analyst</strong><small>SOC Director</small></div>
              <span className="avatar">AM<i /></span>
            </div>
          </div>
        </header>

        <main className="workspace-scroll">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/pivot" element={<Pivot />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </section>

      <ChatWidget />
    </div>
  );
}

export default function App() {
  return <BrowserRouter><Shell /></BrowserRouter>;
}

