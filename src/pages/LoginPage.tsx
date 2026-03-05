import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn, confirmSignIn } from 'aws-amplify/auth';
import Logo from '../components/Logo';
import { isRateLimited, recordLoginAttempt, getRemainingAttempts, executeRecaptcha } from '../lib/loginSecurity';
import { log, logError } from '../lib/logger';
import './LoginPage.css';

export default function LoginPage() {
  useNavigate(); // Not used in this component
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requiresNewPassword, setRequiresNewPassword] = useState(false);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutTime, setLockoutTime] = useState<number | null>(null);

  // Check rate limiting status when email changes
  useEffect(() => {
    if (email) {
      const rateLimitCheck = isRateLimited(email);
      setIsLocked(rateLimitCheck.limited);
      setLockoutTime(rateLimitCheck.retryAfter || null);
      if (!rateLimitCheck.limited) {
        setRemainingAttempts(getRemainingAttempts(email));
      } else {
        setRemainingAttempts(null);
      }
    } else {
      setIsLocked(false);
      setLockoutTime(null);
      setRemainingAttempts(null);
    }
  }, [email]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Check rate limiting before attempting login
    const rateLimitCheck = isRateLimited(email);
    if (rateLimitCheck.limited) {
      setError(rateLimitCheck.message || 'Too many login attempts. Please try again later.');
      setLoading(false);
      setIsLocked(true);
      setLockoutTime(rateLimitCheck.retryAfter || null);
      return;
    }

    // Execute reCAPTCHA (if configured)
    await executeRecaptcha('login');

    try {
      const result = await signIn({ username: email, password });
      
      log('Sign-in result:', result);
      
      // Check if sign-in is complete or requires additional steps
      if (result.isSignedIn || result.nextStep.signInStep === 'DONE') {
        // Sign-in successful - record success
        recordLoginAttempt(email, true);
        // Small delay to ensure tokens are saved to storage
        await new Promise(resolve => setTimeout(resolve, 100));
        // Reload the page to ensure fresh state
        window.location.href = '/admin';
      } else {
        // Handle cases where additional steps are required
        if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          // Show new password form
          setRequiresNewPassword(true);
          setLoading(false);
        } else {
          setError(`Additional authentication required: ${result.nextStep.signInStep}`);
          setLoading(false);
        }
      }
    } catch (err: any) {
      logError('Login error:', err);
      
      // Record failed attempt
      recordLoginAttempt(email, false);
      
      // Check if account is now locked
      const newRateLimitCheck = isRateLimited(email);
      if (newRateLimitCheck.limited) {
        setIsLocked(true);
        setLockoutTime(newRateLimitCheck.retryAfter || null);
        setError(newRateLimitCheck.message || 'Too many failed login attempts. Account temporarily locked.');
      } else {
        const attempts = getRemainingAttempts(email);
        setRemainingAttempts(attempts);
        
        // Provide helpful error messages
        if (err.name === 'NotAuthorizedException') {
          setError(`Invalid email or password. ${attempts > 0 ? `${attempts} attempt(s) remaining.` : 'Account will be locked after more failed attempts.'}`);
        } else if (err.name === 'UserNotConfirmedException') {
          setError('Account not confirmed. Please check your email for verification link.');
        } else if (err.name === 'UserNotFoundException') {
          setError('No account found with this email address.');
        } else {
          setError(err.message || 'Login failed. Please try again.');
        }
      }
      setLoading(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate passwords match
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    // Validate password meets requirements (min 8 chars, uppercase, lowercase, number, symbol)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      setError('Password must be at least 8 characters and contain uppercase, lowercase, number, and symbol');
      setLoading(false);
      return;
    }

    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      
      log('Confirm sign-in result:', result);
      
      if (result.isSignedIn || result.nextStep.signInStep === 'DONE') {
        // Password set successfully, redirect to admin
        await new Promise(resolve => setTimeout(resolve, 100));
        window.location.href = '/admin';
      } else {
        setError(`Unexpected response: ${result.nextStep.signInStep}`);
        setLoading(false);
      }
    } catch (err: any) {
      logError('Set password error:', err);
      setError(err.message || 'Failed to set new password');
      setLoading(false);
    }
  };

  if (requiresNewPassword) {
    return (
      <div className="login-page">
        <div className="login-container">
        <div className="login-logo">
          <Logo />
        </div>
        <p className="login-description">
          Please set a new password for your account.
        </p>
          <form onSubmit={handleSetNewPassword}>
            <div className="form-group">
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="At least 8 characters with uppercase, lowercase, number, and symbol"
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmNewPassword">Confirm New Password</label>
              <input
                id="confirmNewPassword"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            {error && <div className="error-message">{error}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="submit" disabled={loading} className="login-button">
                {loading ? 'Setting password...' : 'Set Password'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRequiresNewPassword(false);
                  setNewPassword('');
                  setConfirmNewPassword('');
                  setError('');
                }}
                className="login-button login-button-secondary"
              >
                Back
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-logo">
          <Logo />
        </div>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          {remainingAttempts !== null && remainingAttempts < 5 && remainingAttempts > 0 && (
            <div className="login-warning">
              ⚠️ {remainingAttempts} attempt(s) remaining before account lockout
            </div>
          )}
          {isLocked && lockoutTime && (
            <div className="login-lockout">
              🔒 Account locked. Please try again in {Math.ceil(lockoutTime / 60)} minute(s).
            </div>
          )}
          <button 
            type="submit" 
            disabled={loading || isLocked} 
            className="login-button"
          >
            {loading ? 'Logging in...' : isLocked ? 'Account Locked' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
