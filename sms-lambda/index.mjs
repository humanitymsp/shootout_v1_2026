// SMS Proxy Lambda - uses form-urlencoded to call TextBelt (required for delivery)
export const handler = async (event) => {
  console.log('Event:', JSON.stringify(event));

  let phone, message, key;
  try {
    const raw = event.body || '{}';
    const decoded = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString() : raw;
    const body = JSON.parse(decoded);
    phone = body.phone;
    message = body.message;
    key = body.key;
  } catch (e) {
    console.log('Parse error:', e.message);
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid body' }) };
  }

  if (!phone || !message || !key) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing phone, message, or key' }) };
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

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
};
