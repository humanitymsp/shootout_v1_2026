import { useEffect, useState } from 'react';

declare global {
  interface Window {
    cast?: any;
    chrome?: any;
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
  }
}

interface CastState {
  isAvailable: boolean;
  isConnected: boolean;
  deviceName: string;
}

export const useGoogleCast = () => {
  const [castState, setCastState] = useState<CastState>({
    isAvailable: false,
    isConnected: false,
    deviceName: '',
  });

  useEffect(() => {
    console.log('Cast: Checking for Cast SDK...');
    
    // Simple check if Cast SDK is available
    const checkCast = () => {
      if (window.cast && window.cast.framework) {
        console.log('Cast: SDK is available');
        setCastState({
          isAvailable: true,
          isConnected: false,
          deviceName: '',
        });
      } else {
        console.log('Cast: SDK not available, using Chrome tab casting');
        setCastState({
          isAvailable: true, // Chrome tab casting is always available in Chrome
          isConnected: false,
          deviceName: '',
        });
      }
    };

    // Check immediately
    checkCast();

    // Set up callback if SDK loads later
    if (!window.cast) {
      window.__onGCastApiAvailable = (isAvailable: boolean) => {
        console.log('Cast: SDK availability callback -', isAvailable);
        checkCast();
      };
    }

    // Poll for SDK (fallback)
    const pollInterval = setInterval(() => {
      if (!castState.isAvailable) {
        checkCast();
      } else {
        clearInterval(pollInterval);
      }
    }, 1000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [castState.isAvailable]);

  const requestCast = async () => {
    console.log('Cast: Requesting cast session...');
    try {
      // Use Chrome's built-in tab casting
      if (window.chrome && window.chrome.cast && window.chrome.cast.requestTab) {
        window.chrome.cast.requestTab(
          (session: any) => {
            console.log('Cast: Tab casting started:', session);
            setCastState(prev => ({
              ...prev,
              isConnected: true,
              deviceName: 'Chromecast',
            }));
          },
          (error: any) => {
            console.error('Cast: Error casting tab:', error);
            alert('Could not start casting. Please use Chrome\'s menu: • → Cast → Select device');
          }
        );
      } else {
        // Try to open Chrome's cast dialog via keyboard shortcut
        alert('To cast this page:\n\n1. Press Ctrl+Shift+P\n2. Type "Cast"\n3. Select "Cast tab"\n4. Choose your Chromecast device\n\nOr use Chrome menu: • → Cast');
      }
    } catch (error) {
      console.error('Cast: Error requesting cast:', error);
      alert('Casting not available. Please use Chrome\'s built-in cast feature from the menu.');
    }
  };

  const stopCast = () => {
    console.log('Cast: Stopping cast...');
    setCastState(prev => ({
      ...prev,
      isConnected: false,
      deviceName: '',
    }));
    
    // Stop tab casting if possible
    if (window.chrome && window.chrome.cast && window.chrome.cast.stop) {
      try {
        window.chrome.cast.stop();
      } catch (e) {
        console.log('Cast: Could not stop casting programmatically');
      }
    }
  };

  return {
    ...castState,
    requestCast,
    stopCast,
  };
};
