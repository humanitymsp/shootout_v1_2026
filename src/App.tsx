import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState, Component, ErrorInfo, ReactNode } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
// Amplify is already configured in main.tsx
import AdminPage from './pages/AdminPage';
import TVPage from './pages/TVPage';
import TabletPage from './pages/TabletPage';
import PublicPage from './pages/PublicPage';
import ConfirmPage from './pages/ConfirmPage';
import LoginPage from './pages/LoginPage';
import ToastContainer from './components/Toast';
import { initializeLocalPlayers } from './lib/localStoragePlayers';
import './App.css';

// Footer Component
function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-content">
        Designed by Humanity MSP (Josh McKinney) for support contact 360-721-7359
      </div>
    </footer>
  );
}

// Error Boundary Component
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message || 'An unexpected error occurred'}</p>
          <button onClick={() => window.location.reload()}>Reload Page</button>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, _setError] = useState<string | null>(null);

  const checkUser = async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      setLoading(false);
    } catch (err: any) {
      // UserUnAuthenticatedException is expected when no user is logged in
      // Only log if it's not an authentication error
      if (err.name !== 'UserUnAuthenticatedException') {
        console.error('Error checking user:', err);
      }
      setUser(null);
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initialize localStorage players system
    initializeLocalPlayers();
    
    // Check current user on mount and when location changes
    checkUser();
    
    // Listen for storage events (login/logout in other tabs)
    const handleStorageChange = () => {
      checkUser();
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also check user when page becomes visible (user might have logged in in another tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkUser();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h1>Error</h1>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Reload Page</button>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div className="app-container">
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={user ? <Navigate to="/admin" replace /> : <LoginPage />}
            />
            <Route
              path="/admin"
              element={user ? <AdminPage user={user} /> : <Navigate to="/login" replace />}
            />
            <Route path="/tv" element={<TVPage />} />
            <Route path="/tablet" element={<TabletPage />} />
            <Route path="/public" element={<PublicPage />} />
            <Route path="/confirm" element={<ConfirmPage />} />
            <Route path="/" element={<Navigate to="/admin" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
      <ToastContainer />
      <Footer />
    </div>
  );
}

export default App;
