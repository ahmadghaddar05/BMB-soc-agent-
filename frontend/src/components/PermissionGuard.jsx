import { Navigate, useLocation } from 'react-router-dom';
import { canAccessRoute, getRoleLanding } from '../lib/roles';

export default function PermissionGuard({ role, children }) {
  const location = useLocation();
  if (canAccessRoute(role, location.pathname)) return children;
  return <Navigate to={getRoleLanding(role)} replace state={{ deniedPath: location.pathname }} />;
}
