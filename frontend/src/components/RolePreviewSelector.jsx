import { ROLE_LABELS, ROLES } from '../lib/roles';

export default function RolePreviewSelector({ enabled, role, onChange }) {
  if (!enabled) return null;
  return (
    <label className="role-preview" title="Presentation preview only. This does not change server permissions.">
      <span>View as</span>
      <select aria-label="Preview experience as role" value={role} onChange={event => onChange(event.target.value)}>
        {Object.values(ROLES).map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
      </select>
    </label>
  );
}
