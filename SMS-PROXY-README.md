# SMS Proxy Server for Development

## The CORS Problem

TextBelt's API doesn't allow direct browser requests due to CORS policy. This means you'll get this error:
```
Access to fetch at 'https://textbelt.com/text' from origin 'http://localhost:3000' has been blocked by CORS policy
```

## Solution: Local Proxy Server

I've created a simple Node.js proxy server that runs locally and forwards SMS requests to TextBelt.

## Setup Instructions

### Option 1: Quick Start (Recommended)

1. Open a new terminal in the project root
2. Install dependencies:
   ```bash
   npm install express cors node-fetch@2
   ```

3. Start the proxy server:
   ```bash
   node sms-proxy-server.js
   ```

4. You should see:
   ```
   🚀 SMS proxy server running on http://localhost:3001
   📱 SMS proxy endpoint: http://localhost:3001/sms-proxy
   💡 Use this to avoid CORS issues when testing SMS locally
   ```

5. Keep this terminal running while you test SMS features

6. In another terminal, start your main app:
   ```bash
   npm run dev
   ```

### Option 2: Production Deployment

For production, you'll need to deploy the backend function:

1. Run the Amplify sandbox:
   ```bash
   npx ampx sandbox
   ```

2. This will deploy the `sendSMSFunction` Lambda function that handles SMS without CORS issues

## How It Works

- **Development**: The app tries to use `http://localhost:3001/sms-proxy` first
- **Fallback**: If the local proxy isn't running, it tries the direct API (which will fail due to CORS)
- **Production**: Use the Amplify function (when deployed)

## Testing

1. Make sure the proxy server is running
2. Go to **More → 📱 SMS Settings**
3. Enter your TextBelt API key
4. Click "Send Test SMS"
5. Check the proxy server terminal for logs

## Troubleshooting

**Error: "Cannot find module 'express'"**
- Run: `npm install express cors node-fetch@2`

**Error: "Port 3001 already in use"**
- Change the PORT in `sms-proxy-server.js` to another port (e.g., 3002)
- Update the port in `src/lib/sms-proxy.ts` line 69

**SMS still not working**
- Check that the proxy server is running
- Check the browser console for errors
- Check the proxy server terminal for logs
- Verify your TextBelt API key is correct
