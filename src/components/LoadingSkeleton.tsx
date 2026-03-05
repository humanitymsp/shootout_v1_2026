import './LoadingSkeleton.css';

interface LoadingSkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export function LoadingSkeleton({ width = '100%', height = '1rem', className = '' }: LoadingSkeletonProps) {
  return (
    <div 
      className={`loading-skeleton ${className}`}
      style={{ width, height }}
    />
  );
}

export function TableCardSkeleton() {
  return (
    <div className="table-card-skeleton">
      <div className="skeleton-header">
        <LoadingSkeleton width="120px" height="1.5rem" />
        <LoadingSkeleton width="80px" height="1rem" />
      </div>
      <div className="skeleton-section">
        <LoadingSkeleton width="100%" height="0.75rem" />
        <LoadingSkeleton width="80%" height="0.75rem" />
        <LoadingSkeleton width="60%" height="0.75rem" />
      </div>
      <div className="skeleton-section">
        <LoadingSkeleton width="100%" height="0.75rem" />
        <LoadingSkeleton width="70%" height="0.75rem" />
      </div>
    </div>
  );
}
