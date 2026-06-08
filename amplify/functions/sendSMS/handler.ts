interface SMSResult {
  success: boolean;
  error?: string;
  quotaRemaining?: number;
  textId?: string;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler = async (event: any): Promise<any> => {
  console.log('Event type:', event.requestContext ? 'HTTP' : 'AppSync');
  const isHttp = !!event.requestContext?.http;

  if (isHttp && event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  let phone: string, message: string, key: string;

  if (isHttp) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    phone = body?.phone;
    message = body?.message;
    key = body?.key;
  } else {
    const args = event.arguments || event;
    phone = args.phone;
    message = args.message;
    key = args.key;
  }

  if (!phone || !message || !key) {
    const errorResult = { success: false, error: 'Missing required fields' };
    if (isHttp) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify(errorResult) };
    }
    return errorResult;
  }

  // key is encoded as "telnyxApiKey::fromNumber"
  const separatorIndex = key.indexOf('::');
  if (separatorIndex === -1) {
    const errorResult = { success: false, error: 'Invalid key format. Expected apiKey::fromNumber' };
    if (isHttp) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify(errorResult) };
    }
    return errorResult;
  }

  const telnyxApiKey = key.substring(0, separatorIndex).trim();
  const fromNumber = normalizePhone(key.substring(separatorIndex + 2).trim());
  const toNumber = normalizePhone(phone);

  if (!telnyxApiKey || !fromNumber) {
    const errorResult = { success: false, error: 'Missing Telnyx API key or from number' };
    if (isHttp) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify(errorResult) };
    }
    return errorResult;
  }

  console.log('Sending via Telnyx from:', fromNumber, 'to:', toNumber, 'Message length:', message.length);

  try {
    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${telnyxApiKey}`,
      },
      body: JSON.stringify({
        from: fromNumber,
        to: toNumber,
        text: message,
      }),
    });

    const result = await response.json() as any;
    console.log('Telnyx response status:', response.status, JSON.stringify(result));

    if (response.ok && result.data) {
      const smsResult: SMSResult = {
        success: true,
        textId: result.data.id,
      };
      if (isHttp) {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(smsResult) };
      }
      return smsResult;
    }

    // Telnyx error response
    const errorMsg = result.errors?.[0]?.detail || result.errors?.[0]?.title || `Telnyx API error (${response.status})`;
    const errorResult: SMSResult = { success: false, error: errorMsg };
    if (isHttp) {
      return { statusCode: response.status, headers: CORS_HEADERS, body: JSON.stringify(errorResult) };
    }
    return errorResult;
  } catch (error: any) {
    console.error('SMS error:', error);
    const errorResult: SMSResult = { success: false, error: error.message || 'SMS service unavailable' };
    if (isHttp) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify(errorResult) };
    }
    return errorResult;
  }
};
