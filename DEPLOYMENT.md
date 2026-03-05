# Deployment Guide - AWS Amplify Gen 2

This guide covers deploying the Final Table Poker Club system to AWS Amplify Gen 2.

## Prerequisites

1. AWS Account with appropriate permissions
2. Node.js 18+ installed
3. AWS CLI configured (optional, for advanced operations)
4. Git repository (for CI/CD deployment)

## Initial Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Amplify Sandbox (Development)

```bash
npx ampx sandbox
```

This command will:
- Create all AWS resources (DynamoDB tables, AppSync API, Cognito User Pool, Lambda functions)
- Generate `amplify_outputs.json` with configuration
- Start a local development environment
- Provide a preview URL

**Important**: Keep the sandbox running while developing. It manages your AWS resources.

### 3. Create Admin User

After the sandbox starts:

1. Go to AWS Console → Cognito → User Pools
2. Find your user pool (name will be in sandbox output)
3. Create a user:
   - Email: your-admin@email.com
   - Temporary password: (set a secure password)
   - Uncheck "Send email invitation" if testing locally

4. On first login, you'll be prompted to change the password

## Local Development

```bash
# Terminal 1: Keep Amplify sandbox running
npx ampx sandbox

# Terminal 2: Run dev server
npm run dev
```

The app will be available at `http://localhost:3000`

## Production Deployment

### Option 1: Amplify Gen 2 Pipeline (Recommended)

1. **Initialize Pipeline**:
```bash
npx ampx pipeline-deploy --branch main --app-id YOUR_APP_ID
```

If you don't have an app ID yet:
```bash
# Create new app in Amplify Console first, then use the app ID
```

2. **Connect Repository**:
   - Push code to GitHub/GitLab/Bitbucket
   - In AWS Amplify Console, connect your repository
   - Amplify will automatically detect the Gen 2 configuration

3. **Configure Build Settings**:
   Amplify Gen 2 automatically detects:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Node version: 18+

4. **Environment Variables**:
   - Amplify Gen 2 automatically injects `amplify_outputs.json` during build
   - No manual environment variables needed

5. **Deploy**:
   - Push to your main branch
   - Amplify will automatically build and deploy

### Option 2: Manual Build & Deploy

1. **Build Locally**:
```bash
npm run build
```

2. **Deploy via Amplify Console**:
   - Go to AWS Amplify Console
   - Create new app → "Deploy without Git provider"
   - Upload `dist` folder as ZIP
   - Configure:
     - Build settings: Use default (already configured)
     - Environment: Production

3. **Manual amplify_outputs.json**:
   If deploying manually, you'll need to:
   - Run `npx ampx sandbox` to generate `amplify_outputs.json`
   - Include it in your build (copy to `dist/`)
   - Or set environment variables manually in Amplify Console

## Post-Deployment

### 1. Verify Resources

Check AWS Console for:
- ✅ DynamoDB tables created
- ✅ AppSync API active
- ✅ Cognito User Pool configured
- ✅ Lambda functions deployed (if using custom functions)

### 2. Create Production Admin User

Same process as development:
1. AWS Console → Cognito → User Pools
2. Create admin user
3. Set permanent password

### 3. Test Deployment

1. Visit your Amplify app URL
2. Login with admin credentials
3. Verify:
   - Admin dashboard loads
   - TV view accessible
   - Can create ClubDay
   - Default tables appear
   - Check-in flow works

## Troubleshooting

### Build Fails

**Error**: `amplify_outputs.json not found`
- **Solution**: Ensure sandbox is running or manually include the file

**Error**: `Module not found`
- **Solution**: Run `npm install` and verify all dependencies in `package.json`

### Runtime Errors

**Error**: `Unauthorized` or auth issues
- **Solution**: Check Cognito User Pool configuration
- Verify user exists and is confirmed
- Check IAM roles for AppSync

**Error**: `Table not found` or DynamoDB errors
- **Solution**: Verify sandbox created all tables
- Check table names match schema
- Verify IAM permissions

### Realtime Not Working

- Check AppSync API status in AWS Console
- Verify WebSocket endpoint is accessible
- Check browser console for connection errors
- System falls back to polling if realtime fails

## Environment-Specific Configuration

### Development
- Uses sandbox resources
- `amplify_outputs.json` generated automatically
- Hot reload enabled

### Staging/Production
- Uses production AWS resources
- `amplify_outputs.json` injected during build
- Optimized build output

## Cost Optimization

- **DynamoDB**: Use on-demand pricing for variable workloads
- **AppSync**: Pay per API request (first 250k requests/month free)
- **Cognito**: First 50k MAU free
- **Lambda**: Pay per invocation (if using custom functions)
- **Amplify Hosting**: Pay per GB transferred

## Security Checklist

- [ ] Cognito User Pool has strong password policy
- [ ] AppSync API has proper authorization rules
- [ ] DynamoDB tables have appropriate access controls
- [ ] No sensitive data in `amplify_outputs.json` (it's public)
- [ ] Admin credentials are secure
- [ ] HTTPS enabled (automatic with Amplify)

## Rollback

If deployment fails:
1. Go to Amplify Console → App → Deployments
2. Select previous successful deployment
3. Click "Redeploy this version"

## Support

For Amplify Gen 2 specific issues:
- [AWS Amplify Documentation](https://docs.amplify.aws/)
- [Amplify Gen 2 Guide](https://docs.amplify.aws/react/build-a-backend/overview/)
