import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    cast: any;
    chrome: any;
  }
}

interface CastState {
  isAvailable: boolean;
  isConnected: boolean;
  deviceName: string;
  isCasting: boolean;
}

export const useGoogleCast = () => {
  const [castState, setCastState] = useState<CastState>({
    isAvailable: false,
    isConnected: false,
    deviceName: '',
    isCasting: false,
  });
  
  const castContextRef = useRef<any>(null);
  const remotePlayerRef = useRef<any>(null);
  const remotePlayerControllerRef = useRef<any>(null);

  useEffect(() => {
    // Initialize Cast SDK
    const initializeCast = () => {
      if (!window.cast || !window.cast.framework) {
        console.warn('Cast SDK not loaded');
        return;
      }

      const CastContext = window.cast.framework.CastContext;
      const CastContextEventType = window.cast.framework.CastContextEventType;
      const RemotePlayer = window.cast.framework.RemotePlayer;
      const RemotePlayerController = window.cast.framework.RemotePlayerController;
      const castConfig = new window.cast.framework.CastContextConfig();

      // Configure cast context
      castConfig.receiverApplicationId = window.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
      castConfig.autoJoinPolicy = window.cast.AutoJoinPolicy.ORIGIN_SCOPED;
      castConfig.language = 'en-US';

      // Create cast context
      castContextRef.current = new CastContext(castConfig);
      
      // Create remote player and controller
      remotePlayerRef.current = new RemotePlayer();
      remotePlayerControllerRef.current = new RemotePlayerController(remotePlayerRef.current);

      // Listen for cast state changes
      castContextRef.current.addEventListener(
        CastContextEventType.CAST_STATE_CHANGED,
        (event: any) => {
          const castState = event.castState;
          setCastState(prev => ({
            ...prev,
            isAvailable: true,
            isConnected: castState === window.cast.framework.CastState.CONNECTED,
            deviceName: castState === window.cast.framework.CastState.CONNECTED 
              ? castContextRef.current.getCastDevice().friendlyName 
              : '',
          }));
        }
      );

      // Listen for player state changes
      remotePlayerControllerRef.current.addEventListener(
        'isConnectedChanged',
        (event: any) => {
          setCastState(prev => ({
            ...prev,
            isCasting: event.value,
          }));
        }
      );

      setCastState(prev => ({
        ...prev,
        isAvailable: true,
      }));
    };

    // Wait for Cast SDK to be ready
    if (window.__onGCastApiAvailable) {
      window.__onGCastApiAvailable = (isAvailable: boolean) => {
        if (isAvailable) {
          initializeCast();
        }
      };
    } else if (window.cast && window.cast.framework) {
      initializeCast();
    }

    return () => {
      // Cleanup
      if (castContextRef.current) {
        castContextRef.current.end();
      }
    };
  }, []);

  const requestCast = async () => {
    if (!castContextRef.current) return;
    
    try {
      await castContextRef.current.requestSession();
    } catch (error) {
      console.error('Error requesting cast session:', error);
    }
  };

  const stopCast = () => {
    if (castContextRef.current) {
      castContextRef.current.endSession();
    }
  };

  const castTab = () => {
    if (window.chrome && window.chrome.cast) {
      window.chrome.cast.requestTab(
        (session: any) => {
          console.log('Tab casting started:', session);
        },
        (error: any) => {
          console.error('Error casting tab:', error);
        }
      );
    }
  };

  return {
    ...castState,
    requestCast,
    stopCast,
    castTab,
  };
};
