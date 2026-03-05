// Simple SMS proxy server for development
// Run with: node sms-proxy-server.js

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// SMS proxy endpoint
app.post('/sms-proxy', async (req, res) => {
  try {
    const { phone, message, key } = req.body;

    if (!phone || !message || !key) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: phone, message, key' 
      });
    }

    console.log(`Proxying SMS to: ${phone.replace(/\d(?=\d{4})/g, '*')}`);

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
    
    console.log('TextBelt response:', result.success ? 'SUCCESS' : 'FAILED');
    
    // Return the result
    return res.status(200).json(result);
  } catch (error) {
    console.error('SMS proxy error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'SMS service unavailable' 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'SMS proxy server is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 SMS proxy server running on http://localhost:${PORT}`);
  console.log('📱 SMS proxy endpoint: http://localhost:3001/sms-proxy');
  console.log('💡 Use this to avoid CORS issues when testing SMS locally');
});
