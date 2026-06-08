/**
 * SMS Proxy - Legacy fallback module.
 *
 * The primary SMS path now uses the AppSync sendSMS mutation → Lambda → Telnyx.
 * These proxy functions are retained as a fallback but are not used in the
 * normal flow. If you need direct browser-to-API SMS sending (e.g. for local
 * dev without a deployed backend), these can be adapted.
 */

interface SMSRequest {
  phone: string;
  message: string;
  key: string; // encoded as "telnyxApiKey::fromNumber"
}

interface SMSResponse {
  success: boolean;
  error?: string;
  quotaRemaining?: number;
  textId?: string;
}

/**
 * Send SMS via Telnyx using a local dev proxy (localhost:3001)
 */
export async function sendSMSViaProxy(request: SMSRequest): Promise<SMSResponse> {
  try {
    const response = await fetch('http://localhost:3001/sms-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return {
      success: result.success,
      error: result.error,
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
 * Falls back to the AppSync mutation path which is the primary delivery mechanism.
 */
export async function sendSMSViaPublicProxy(request: SMSRequest): Promise<SMSResponse> {
  try {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return sendSMSViaProxy(request);
    }

    // In production, the AppSync mutation is used directly (see sms.ts sendSMS).
    // This function should not be called in production.
    return {
      success: false,
      error: 'Direct proxy not available in production. Use AppSync sendSMS mutation.',
    };
  } catch (error) {
    console.error('SMS API error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SMS service unavailable',
    };
  }
}
