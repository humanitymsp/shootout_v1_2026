// Vercel Edge Function for SMS proxy
// Uses form-urlencoded to call TextBelt (required for delivery)

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { phone, message, key } = body;

    if (!phone || !message || !key) {
      return new Response(JSON.stringify({ success: false, error: 'Missing phone, message, or key' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Normalize phone to E.164
    const digits = phone.replace(/\D/g, '');
    const normalized = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+${digits}`;

    console.log('[SMS] Sending to:', normalized);

    // CRITICAL: Use form-urlencoded (NOT JSON) - TextBelt only delivers with this format
    const params = new URLSearchParams();
    params.set('phone', normalized);
    params.set('message', message);
    params.set('key', key);

    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params.toString(),
    });

    const result = await res.json();
    console.log('TextBelt response:', JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('[SMS] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
