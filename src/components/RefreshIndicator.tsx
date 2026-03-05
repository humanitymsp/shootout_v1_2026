import { useState, useEffect } from 'react';
import './RefreshIndicator.css';

interface RefreshIndicatorProps {
  lastUpdateTime: Date | null;
}

export default function RefreshIndicator({ lastUpdateTime }: RefreshIndicatorProps) {
  const [timeAgo, setTimeAgo] = useState<string>('');

  useEffect(() => {
    if (!lastUpdateTime) {
      setTimeAgo('');
      return;
    }

    const updateTimeAgo = () => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - lastUpdateTime.getTime()) / 1000);

      if (diff < 5) {
        setTimeAgo('Just now');
      } else if (diff < 60) {
        setTimeAgo(`${diff}s ago`);
      } else if (diff < 3600) {
        const minutes = Math.floor(diff / 60);
        setTimeAgo(`${minutes}m ago`);
      } else {
        const hours = Math.floor(diff / 3600);
        setTimeAgo(`${hours}h ago`);
      }
    };

    updateTimeAgo();
    const interval = setInterval(updateTimeAgo, 1000);

    return () => clearInterval(interval);
  }, [lastUpdateTime]);

  if (!lastUpdateTime) return null;

  return (
    <div className="refresh-indicator">
      <span className="refresh-indicator-dot"></span>
      <span className="refresh-indicator-text">Updated {timeAgo}</span>
    </div>
  );
}
