/**
 * Worker-based timer that is NOT throttled by Chrome's background tab policy.
 *
 * Chrome throttles setInterval in background/hidden tabs to at most once per
 * minute (often much longer). When a tab is being cast to a TV via Chrome tab
 * casting, the originating tab can be treated as "background" and timers stall.
 *
 * This module creates an inline Web Worker that runs a setInterval inside the
 * worker thread. Worker timers are exempt from background throttling, so the
 * callback fires reliably regardless of tab visibility.
 *
 * Usage:
 *   const stop = createWorkerInterval(callback, 15000);
 *   // later:
 *   stop();
 *
 * Cost impact: None — this is purely a client-side timer mechanism. It does not
 * add any API calls; it only ensures existing poll callbacks fire on schedule.
 */

const WORKER_SCRIPT = `
  let timerId = null;
  self.onmessage = function(e) {
    if (e.data.command === 'start') {
      if (timerId) clearInterval(timerId);
      timerId = setInterval(function() {
        self.postMessage('tick');
      }, e.data.interval);
    } else if (e.data.command === 'stop') {
      if (timerId) clearInterval(timerId);
      timerId = null;
    }
  };
`;

/**
 * Create a reliable interval that fires even when the tab is in the background.
 * Returns a cleanup function to stop the timer.
 */
export function createWorkerInterval(callback: () => void, intervalMs: number): () => void {
  try {
    const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    worker.onmessage = () => {
      callback();
    };

    worker.postMessage({ command: 'start', interval: intervalMs });

    return () => {
      worker.postMessage({ command: 'stop' });
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    // Fallback: if Workers are unavailable, use regular setInterval
    const id = setInterval(callback, intervalMs);
    return () => clearInterval(id);
  }
}
