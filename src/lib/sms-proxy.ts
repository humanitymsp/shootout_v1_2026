/**
 * SMS Proxy - A simple proxy to avoid CORS issues
 * This can be deployed as a serverless function or used with a CORS proxy
 */

interface SMSRequest {
  phone: string;
  message: string;
  key: string;
}

interface SMSResponse {
  success: boolean;
  error?: string;
  quotaRemaining?: number;
  textId?: string;
}

/**
 * Send SMS via TextBelt using a proxy approach
 * For now, we'll use a CORS proxy service for development
 * In production, this should be replaced with a proper backend endpoint
 */
export async function sendSMSViaProxy(request: SMSRequest): Promise<SMSResponse> {
  try {
    // Using a CORS proxy for development
    // In production, replace with your own backend endpoint
    const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
    const targetUrl = 'https://textbelt.com/text';
    
    const response = await fetch(proxyUrl + targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    return {
      success: result.success,
      error: result.error,
      quotaRemaining: result.quotaRemaining,
      textId: result.textId,
    };
  } catch (error) {
    console.error('SMS proxy error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SMS service unavailable',
    };
  }
}

/**
 * Send SMS via proxy (works in both development and production)
 */
export async function sendSMSViaPublicProxy(request: SMSRequest): Promise<SMSResponse> {
  try {
    // Try local proxy first in development
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        const response = await fetch('http://localhost:3001/sms-proxy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        });

        if (response.ok) {
          const result = await response.json();
          return {
            success: result.success,
            error: result.error,
            quotaRemaining: result.quotaRemaining,
            textId: result.textId,
          };
        }
      } catch (localError) {
        console.log('Local proxy not available, falling back to production proxy...');
      }
    }
    
    // Production: Build URL with query params to avoid POST CORS issues
    // TextBelt also accepts GET requests with query parameters
    const params = new URLSearchParams({
      phone: request.phone,
      message: request.message,
      key: request.key,
    });
    
    const textbeltUrl = `https://textbelt.com/text?${params.toString()}`;
    
    // Use AllOrigins for GET request
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(textbeltUrl)}`;
    
    const response = await fetch(proxyUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status} ${response.statusText}`);
    }

    const proxyResult = await response.json();
    const result = JSON.parse(proxyResult.contents);
    
    return {
      success: result.success,
      error: result.error,
      quotaRemaining: result.quotaRemaining,
      textId: result.textId,
    };
  } catch (error) {
    console.error('SMS API error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SMS service unavailable',
    };
  }
}
