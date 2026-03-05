// Simple SMS proxy for development
// This can be deployed to Vercel, Netlify, or any serverless platform

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

    // Call TextBelt API with form-urlencoded payload (required for delivery)
    const digits = String(phone).replace(/\D/g, '');
    const normalizedPhone = digits.length === 10
      ? `+1${digits}`
      : (digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+${digits}`);

    const body = new URLSearchParams();
    body.set('phone', normalizedPhone);
    body.set('message', String(message));
    body.set('key', String(key).trim());

    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: body.toString(),
    });

    const result = await response.json();
    
    // Return the result
    return res.status(200).json(result);
  } catch (error) {
    console.error('SMS proxy error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'SMS service unavailable' 
    });
  }
}
