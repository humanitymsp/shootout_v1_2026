interface SMSArgs {
  phone: string;
  message: string;
  key: string;
}

interface SMSResult {
  success: boolean;
  error?: string;
  quotaRemaining?: number;
  textId?: string;
}

function normalizePhone(phone: string): string {
  // Strip all non-digits
  const digits = phone.replace(/\D/g, '');
  // US number: 10 digits → add +1, 11 digits starting with 1 → add +
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Already has country code or international
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

  // Handle CORS preflight
  if (isHttp && event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Parse args from either HTTP Function URL or AppSync event
  let phone: string, message: string, key: string;

  if (isHttp) {
    // Function URL HTTP event
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    phone = body?.phone;
    message = body?.message;
    key = body?.key;
  } else {
    // AppSync event
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

  const normalizedPhone = normalizePhone(phone);
  console.log('Sending to:', normalizedPhone, 'Message length:', message.length);

  try {
    // Use form-urlencoded (NOT JSON) - this is the format that delivers SMS
    // Proven by command line test: application/x-www-form-urlencoded delivers, application/json gets FAILED
    const body = new URLSearchParams();
    body.set('phone', normalizedPhone);
    body.set('message', message);
    body.set('key', key);

    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
    });

    const result = await response.json() as any;
    console.log('TextBelt response:', JSON.stringify(result));

    if (isHttp) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(result) };
    }
    return { success: result.success, error: result.error, quotaRemaining: result.quotaRemaining, textId: result.textId };
  } catch (error: any) {
    console.error('SMS error:', error);
    const errorResult = { success: false, error: error.message || 'SMS service unavailable' };
    if (isHttp) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify(errorResult) };
    }
    return errorResult;
  }
};
