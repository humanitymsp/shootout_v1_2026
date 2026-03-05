// Netlify serverless function for SMS proxy
exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { phone, message, key } = JSON.parse(event.body);

    if (!phone || !message || !key) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: phone, message, key' 
        }),
      };
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
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('SMS proxy error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message || 'SMS service unavailable' 
      }),
    };
  }
};
