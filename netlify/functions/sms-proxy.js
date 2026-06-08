// Netlify serverless function for SMS proxy (Telnyx P2P)

function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { phone, message, key } = JSON.parse(event.body);

    if (!phone || !message || !key) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing required fields' }),
      };
    }

    // key is encoded as "telnyxApiKey::fromNumber"
    const separatorIndex = String(key).indexOf('::');
    if (separatorIndex === -1) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid key format. Expected apiKey::fromNumber' }),
      };
    }

    const telnyxApiKey = String(key).substring(0, separatorIndex).trim();
    const fromNumber = normalizePhone(String(key).substring(separatorIndex + 2).trim());
    const toNumber = normalizePhone(phone);

    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${telnyxApiKey}`,
      },
      body: JSON.stringify({ from: fromNumber, to: toNumber, text: String(message) }),
    });

    const result = await response.json();

    if (response.ok && result.data) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, textId: result.data.id }) };
    }

    const errorMsg = result.errors?.[0]?.detail || result.errors?.[0]?.title || `Telnyx API error (${response.status})`;
    return { statusCode: response.status, headers, body: JSON.stringify({ success: false, error: errorMsg }) };
  } catch (error) {
    console.error('SMS proxy error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message || 'SMS service unavailable' }),
    };
  }
};
