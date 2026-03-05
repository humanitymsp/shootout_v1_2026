# SMS CORS Solution - Deployment Instructions

## The Problem
TextBelt's API blocks direct browser requests due to CORS policy, causing this error:
```
Access to fetch at 'https://textbelt.com/text' from origin 'https://ftpc.humanitymsp.com' has been blocked by CORS policy
```

## Solution Options

### Option 1: Deploy Lambda Function (Recommended for Production)

Since you're using Amplify Hosting with manual zip uploads, you need to manually deploy the Lambda function:

1. **Deploy the Lambda function:**
   ```bash
   cd amplify
   npx ampx sandbox
   ```
   This will deploy the `sendSMSFunction` and give you a function URL.

2. **Get the function URL:**
   - After deployment, look for the function URL in the output
   - It will look like: `https://abc123.lambda-url.us-west-2.on.aws/`

3. **Update the SMS proxy to use your function URL:**
   - Edit `src/lib/sms-proxy.ts`
   - Replace line 97 with your function URL:
     ```typescript
     proxyUrl = 'YOUR_LAMBDA_FUNCTION_URL_HERE';
     ```

4. **Rebuild and deploy:**
   ```bash
   npm run deploy:zip
   ```
   Upload the new `assets.zip` to Amplify

### Option 2: Use a Public CORS Proxy (Quick Fix for Testing)

For immediate testing, you can use a public CORS proxy:

1. **Edit `src/lib/sms-proxy.ts` line 97:**
   ```typescript
   proxyUrl = 'https://corsproxy.io/?https://textbelt.com/text';
   ```

2. **Rebuild:**
   ```bash
   npm run deploy:zip
   ```

3. **Upload to Amplify**

**Note:** Public proxies are not recommended for production as they may be unreliable or have rate limits.

### Option 3: Create Your Own Simple Proxy (Best for Control)

Deploy a simple proxy on Vercel, Netlify, or any serverless platform:

1. **Create a new Vercel/Netlify project**

2. **Add this function** (for Vercel, create `api/sms-proxy.js`):
   ```javascript
   export default async function handler(req, res) {
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

       const response = await fetch('https://textbelt.com/text', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ phone, message, key }),
       });

       const result = await response.json();
       return res.status(200).json(result);
     } catch (error) {
       return res.status(500).json({ 
         success: false, 
         error: error.message 
       });
     }
   }
   ```

3. **Deploy to Vercel:**
   ```bash
   vercel deploy
   ```

4. **Update `src/lib/sms-proxy.ts` line 97** with your Vercel URL:
   ```typescript
   proxyUrl = 'https://your-project.vercel.app/api/sms-proxy';
   ```

5. **Rebuild and deploy**

## Current Status

The code is ready but needs one of the above solutions to work in production. The Lambda function is prepared in `amplify/functions/sendSMS/` but needs to be deployed.

## Quick Test (Development Only)

For local testing, you can run the proxy server:
```bash
npm install express cors node-fetch@2
node sms-proxy-server.js
```

Then in another terminal:
```bash
npm run dev
```

This will work locally but won't help with production deployment.
