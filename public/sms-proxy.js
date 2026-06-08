// Simple SMS proxy for development (Telnyx P2P)
// This can be deployed to Vercel, Netlify, or any serverless platform

function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, key } = req.body;

    if (!phone || !message || !key) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: phone, message, key' 
      });
    }

    // key is encoded as "telnyxApiKey::fromNumber"
    const separatorIndex = String(key).indexOf('::');
    if (separatorIndex === -1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid key format. Expected apiKey::fromNumber',
      });
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
      body: JSON.stringify({
        from: fromNumber,
        to: toNumber,
        text: String(message),
      }),
    });

    const result = await response.json();

    if (response.ok && result.data) {
      return res.status(200).json({ success: true, textId: result.data.id });
    }

    const errorMsg = result.errors?.[0]?.detail || result.errors?.[0]?.title || `Telnyx API error (${response.status})`;
    return res.status(response.status).json({ success: false, error: errorMsg });
  } catch (error) {
    console.error('SMS proxy error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'SMS service unavailable' 
    });
  }
}
