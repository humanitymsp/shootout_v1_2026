// Logger utility - only logs in development mode
// Prevents sensitive data exposure and performance impact in production

const isDevelopment = (import.meta as any).env?.DEV ?? (import.meta as any).env?.MODE === 'development';

/**
 * Logs debug information (only in development)
 */
export function log(...args: any[]): void {
  if (isDevelopment) {
    console.log(...args);
  }
}

/**
 * Logs warnings (always logged, but can be filtered)
 */
export function logWarn(...args: any[]): void {
  if (isDevelopment) {
    console.warn(...args);
  }
}

/**
 * Logs errors (always logged - these are important)
 */
export function logError(...args: any[]): void {
  console.error(...args);
}

/**
 * Logs info messages (only in development)
 */
export function logInfo(...args: any[]): void {
  if (isDevelopment) {
    console.info(...args);
  }
}
