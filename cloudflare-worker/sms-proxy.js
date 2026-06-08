// Cloudflare Worker to proxy SMS requests to Telnyx P2P

function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    try {
      const body = await request.json();
      const { phone, message, key } = body;

      if (!phone || !message || !key) {
        return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      // key is encoded as "telnyxApiKey::fromNumber"
      const separatorIndex = String(key).indexOf('::');
      if (separatorIndex === -1) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid key format. Expected apiKey::fromNumber' }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      const telnyxApiKey = String(key).substring(0, separatorIndex).trim();
      const fromNumber = normalizePhone(String(key).substring(separatorIndex + 2).trim());
      const toNumber = normalizePhone(phone);

      const telnyxResponse = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${telnyxApiKey}`,
        },
        body: JSON.stringify({ from: fromNumber, to: toNumber, text: String(message) }),
      });

      const result = await telnyxResponse.json();

      if (telnyxResponse.ok && result.data) {
        return new Response(JSON.stringify({ success: true, textId: result.data.id }), {
          status: 200,
          headers: CORS_HEADERS,
        });
      }

      const errorMsg = result.errors?.[0]?.detail || result.errors?.[0]?.title || `Telnyx API error (${telnyxResponse.status})`;
      return new Response(JSON.stringify({ success: false, error: errorMsg }), {
        status: telnyxResponse.status,
        headers: CORS_HEADERS,
      });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: CORS_HEADERS,
      });
    }
  },
};
