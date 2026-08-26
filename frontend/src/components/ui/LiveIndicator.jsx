export default function LiveIndicator({ label = 'Live' }) {
  return <span className="ui-live-indicator"><i aria-hidden="true" /><span>{label}</span></span>;
}
