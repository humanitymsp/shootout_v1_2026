// Cloudflare Worker to proxy SMS requests to TextBelt
// This bypasses AWS Lambda IP blocking by using Cloudflare's IP range

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Parse request body
      const body = await request.json();
      const { phone, message, key } = body;

      if (!phone || !message || !key) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: phone, message, key' 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // Forward to TextBelt using form-urlencoded (required for carrier delivery)
      const digits = String(phone).replace(/\D/g, '');
      const normalizedPhone = digits.length === 10
        ? `+1${digits}`
        : (digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+${digits}`);

      const body = new URLSearchParams();
      body.set('phone', normalizedPhone);
      body.set('message', String(message));
      body.set('key', String(key).trim());

      const textBeltResponse = await fetch('https://textbelt.com/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString(),
      });

      const result = await textBeltResponse.json();

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
