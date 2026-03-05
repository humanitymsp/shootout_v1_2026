// Login Security Utilities
// Provides rate limiting, attempt tracking, and CAPTCHA integration

interface LoginAttempt {
  timestamp: number;
  email: string;
  success: boolean;
  ip?: string;
}

interface RateLimitState {
  attempts: LoginAttempt[];
  lockedUntil?: number;
}

const MAX_ATTEMPTS = 5; // Maximum failed attempts before lockout
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes window for tracking attempts
const RATE_LIMIT_KEY = 'login_security_state';
const MIN_TIME_BETWEEN_ATTEMPTS = 2000; // 2 seconds minimum between attempts

/**
 * Get client IP address (approximate, from headers if available)
 */
function getClientIP(): string {
  // In a real implementation, this would come from server-side headers
  // For client-side, we use a fingerprint based on available data
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
  ].join('|');
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `client_${Math.abs(hash)}`;
}

/**
 * Load rate limit state from localStorage
 */
function loadRateLimitState(): RateLimitState {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_KEY);
    if (stored) {
      const state = JSON.parse(stored) as RateLimitState;
      // Clean up old attempts outside the window
      const now = Date.now();
      state.attempts = state.attempts.filter(
        attempt => now - attempt.timestamp < ATTEMPT_WINDOW
      );
      
      // Check if lockout has expired
      if (state.lockedUntil && now > state.lockedUntil) {
        state.lockedUntil = undefined;
      }
      
      return state;
    }
  } catch (error) {
    console.error('Error loading rate limit state:', error);
  }
  return { attempts: [] };
}

/**
 * Save rate limit state to localStorage
 */
function saveRateLimitState(state: RateLimitState): void {
  try {
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Error saving rate limit state:', error);
  }
}

/**
 * Check if login is rate limited
 */
export function isRateLimited(email: string): { limited: boolean; message?: string; retryAfter?: number } {
  const state = loadRateLimitState();
  const now = Date.now();
  
  // Check if account is locked
  if (state.lockedUntil && now < state.lockedUntil) {
    const retryAfter = Math.ceil((state.lockedUntil - now) / 1000 / 60); // minutes
    return {
      limited: true,
      message: `Too many failed login attempts. Please try again in ${retryAfter} minute(s).`,
      retryAfter: retryAfter * 60, // seconds
    };
  }
  
  // Check minimum time between attempts
  const recentAttempts = state.attempts.filter(
    attempt => now - attempt.timestamp < MIN_TIME_BETWEEN_ATTEMPTS
  );
  if (recentAttempts.length > 0) {
    const timeLeft = Math.ceil((MIN_TIME_BETWEEN_ATTEMPTS - (now - recentAttempts[0].timestamp)) / 1000);
    return {
      limited: true,
      message: `Please wait ${timeLeft} second(s) before trying again.`,
      retryAfter: timeLeft,
    };
  }
  
  // Count failed attempts for this email
  const failedAttempts = state.attempts.filter(
    attempt => attempt.email.toLowerCase() === email.toLowerCase() && !attempt.success
  );
  
  if (failedAttempts.length >= MAX_ATTEMPTS) {
    // Lock account
    const lockedUntil = now + LOCKOUT_DURATION;
    state.lockedUntil = lockedUntil;
    saveRateLimitState(state);
    const retryAfter = Math.ceil(LOCKOUT_DURATION / 1000 / 60);
    return {
      limited: true,
      message: `Too many failed login attempts. Account locked for ${retryAfter} minutes.`,
      retryAfter: retryAfter * 60,
    };
  }
  
  return { limited: false };
}

/**
 * Record a login attempt
 */
export function recordLoginAttempt(email: string, success: boolean): void {
  const state = loadRateLimitState();
  const now = Date.now();
  
  // Add new attempt
  state.attempts.push({
    timestamp: now,
    email: email.toLowerCase(),
    success,
    ip: getClientIP(),
  });
  
  // Clean up old attempts
  state.attempts = state.attempts.filter(
    attempt => now - attempt.timestamp < ATTEMPT_WINDOW
  );
  
  // If successful, clear lockout
  if (success) {
    state.lockedUntil = undefined;
    // Clear attempts for this email on successful login
    state.attempts = state.attempts.filter(
      attempt => attempt.email.toLowerCase() !== email.toLowerCase()
    );
  }
  
  saveRateLimitState(state);
}

/**
 * Get remaining attempts before lockout
 */
export function getRemainingAttempts(email: string): number {
  const state = loadRateLimitState();
  const failedAttempts = state.attempts.filter(
    attempt => attempt.email.toLowerCase() === email.toLowerCase() && !attempt.success
  );
  return Math.max(0, MAX_ATTEMPTS - failedAttempts.length);
}

/**
 * Clear rate limit state (for testing or admin override)
 */
export function clearRateLimitState(): void {
  localStorage.removeItem(RATE_LIMIT_KEY);
}

/**
 * Initialize reCAPTCHA v3 (invisible CAPTCHA)
 * Note: You'll need to add your reCAPTCHA site key to environment variables
 */
export async function executeRecaptcha(action: string): Promise<string | null> {
  const recaptchaSiteKey = (import.meta as any).env?.VITE_RECAPTCHA_SITE_KEY;
  
  if (!recaptchaSiteKey) {
    // If no reCAPTCHA key is configured, skip CAPTCHA
    console.warn('reCAPTCHA site key not configured. Skipping CAPTCHA verification.');
    return null;
  }
  
  return new Promise((resolve) => {
    // Check if reCAPTCHA script is loaded
    if (typeof window.grecaptcha === 'undefined') {
      // Load reCAPTCHA script
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.grecaptcha.ready(() => {
          window.grecaptcha.execute(recaptchaSiteKey, { action })
            .then((token: string) => resolve(token))
            .catch(() => resolve(null));
        });
      };
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    } else {
      // reCAPTCHA already loaded
      window.grecaptcha.ready(() => {
        window.grecaptcha.execute(recaptchaSiteKey, { action })
          .then((token: string) => resolve(token))
          .catch(() => resolve(null));
      });
    }
  });
}

// Extend Window interface for TypeScript
declare global {
  interface Window {
    grecaptcha: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}
