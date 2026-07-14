import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { ShieldAlert, LayoutDashboard, Bell, Network, Settings, Activity, AlertTriangle, FileText } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Alerts    from './pages/Alerts';
import Incidents from './pages/Incidents';
import Pivot     from './pages/Pivot';
import SettingsPage from './pages/Settings';
import Reports from './pages/Reports';
import ChatWidget from './components/ChatWidget';
import './index.css';

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/alerts',    icon: Bell,            label: 'Alerts'      },
  { to: '/incidents', icon: AlertTriangle,   label: 'Incidents'   },
  { to: '/pivot',     icon: Network,         label: 'IOC Pivot'   },
  { to: '/reports',   icon: FileText,        label: 'Reports'     },
  { to: '/settings',  icon: Settings,        label: 'Settings'    },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden">
        {/* ── Sidebar ── */}
        <aside className="w-60 flex-shrink-0 bg-dark-800 border-r border-dark-600 flex flex-col">
          {/* Logo */}
          <div className="flex items-center gap-3 px-5 py-5 border-b border-dark-600">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent/20">
              <ShieldAlert className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">SOC Agent</div>
              <div className="text-xs text-gray-500">Security Operations</div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Status dot */}
          <div className="px-5 py-4 border-t border-dark-600">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Agent running
            </div>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="flex-1 overflow-y-auto bg-dark-900">
          <Routes>
            <Route path="/"          element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/alerts"    element={<Alerts />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/pivot"     element={<Pivot />} />
            <Route path="/reports"   element={<Reports />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Routes>
        </main>

        {/* Floating SOC assistant — available on every page */}
        <ChatWidget />
      </div>
    </BrowserRouter>
  );
}
