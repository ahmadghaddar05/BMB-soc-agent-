export default function EmptyState({ icon: Icon, message = 'No data in this range', action }) {
  return (
    <div className="ui-empty-state">
      {Icon && <Icon size={32} strokeWidth={1.5} aria-hidden="true" />}
      <p>{message}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
