import { cx } from './utils';

export default function SkeletonLoader({ lines = 3, className }) {
  return <div className={cx('ui-skeleton-stack', className)} role="status" aria-label="Loading content">{Array.from({ length: lines }, (_, index) => <span className="ui-skeleton" key={index} />)}</div>;
}
