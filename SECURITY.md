# Security Features - Login Page

This document outlines the security measures implemented to protect the login page without requiring 2FA.

## Implemented Security Features

### 1. **Rate Limiting & Account Lockout**
- **Client-side rate limiting**: Tracks login attempts per email address
- **Maximum attempts**: 5 failed attempts before lockout
- **Lockout duration**: 15 minutes
- **Minimum time between attempts**: 2 seconds to prevent rapid-fire attacks
- **Attempt tracking window**: 15 minutes (attempts older than 15 minutes are cleared)

**How it works:**
- Failed login attempts are tracked in localStorage
- After 5 failed attempts, the account is locked for 15 minutes
- Users see a warning message showing remaining attempts
- Lockout status is displayed with countdown timer

### 2. **AWS Cognito Built-in Security**
- **Automatic account lockout**: Cognito automatically locks accounts after 5 failed attempts
- **Strong password policy**: 
  - Minimum 8 characters
  - Requires uppercase, lowercase, numbers, and symbols
- **Email verification**: Required for account activation
- **Secure token management**: Tokens stored securely by Amplify

### 3. **reCAPTCHA v3 Integration (Optional)**
- **Invisible CAPTCHA**: Runs in the background without user interaction
- **Action-based scoring**: Different scores for login vs. other actions
- **Configurable**: Can be enabled/disabled via environment variable

**To enable reCAPTCHA:**
1. Get a reCAPTCHA v3 site key from [Google reCAPTCHA](https://www.google.com/recaptcha/admin)
2. Add to your `.env` file:
   ```
   VITE_RECAPTCHA_SITE_KEY=your_site_key_here
   ```
3. The system will automatically use it if configured

### 4. **Enhanced Error Handling**
- **Specific error messages**: Different messages for different failure types
- **User-friendly feedback**: Clear indication of remaining attempts
- **Security-aware messaging**: Doesn't reveal if email exists or not (prevents enumeration)

### 5. **Session Management**
- **Secure token storage**: Managed by AWS Amplify
- **Automatic token refresh**: Handled by Amplify SDK
- **Session timeout**: Managed by Cognito

## Security Best Practices

### For Administrators

1. **Use Strong Passwords**
   - Follow the password policy requirements
   - Use unique passwords not used elsewhere
   - Consider using a password manager

2. **Monitor Login Attempts**
   - Check AWS CloudWatch logs for suspicious activity
   - Review failed login attempts regularly

3. **IP Restrictions (Optional)**
   - Consider implementing IP whitelisting at AWS WAF level
   - Or use AWS Cognito Advanced Security Features

4. **Regular Security Audits**
   - Review user access regularly
   - Remove unused accounts
   - Monitor for unusual login patterns

### For Developers

1. **Environment Variables**
   - Never commit `.env` files with secrets
   - Use AWS Secrets Manager for production secrets
   - Rotate API keys regularly

2. **HTTPS Only**
   - Ensure HTTPS is enforced in production
   - Amplify Hosting automatically provides HTTPS

3. **Cognito Configuration**
   - Review Cognito User Pool settings in AWS Console
   - Enable advanced security features if needed
   - Configure password expiration policies

## Additional Security Recommendations

### 1. **AWS WAF Integration** (Recommended for Production)
Add Web Application Firewall rules:
- Rate limiting at the edge
- IP reputation filtering
- Geographic restrictions (if applicable)
- Bot protection

### 2. **CloudWatch Alarms**
Set up alarms for:
- Multiple failed login attempts
- Unusual login patterns
- Account lockouts

### 3. **AWS Cognito Advanced Security Features**
Consider enabling:
- **Compromised credentials detection**: Detects if credentials are leaked
- **Risk-based authentication**: Adjusts security based on risk score
- **Device tracking**: Tracks trusted devices

### 4. **Backend Rate Limiting** (Future Enhancement)
For additional security, implement server-side rate limiting:
- Use AWS API Gateway throttling
- Implement custom Lambda authorizer
- Use DynamoDB to track attempts server-side

## Testing Security Features

### Test Rate Limiting
1. Attempt to login with wrong password 5 times
2. Verify account is locked
3. Wait 15 minutes or clear localStorage to test unlock
4. Verify remaining attempts counter works

### Test reCAPTCHA (if enabled)
1. Verify reCAPTCHA token is generated
2. Check browser console for any errors
3. Test with invalid site key to ensure graceful fallback

## Troubleshooting

### Account Locked
- **Solution**: Wait 15 minutes or clear browser localStorage
- **Admin override**: Use AWS Cognito Console to unlock account

### reCAPTCHA Not Working
- **Check**: Environment variable is set correctly
- **Verify**: Site key is valid and domain is registered
- **Note**: System works without reCAPTCHA if not configured

### Rate Limiting Too Aggressive
- **Adjust**: Modify constants in `src/lib/loginSecurity.ts`
- **Settings**: `MAX_ATTEMPTS`, `LOCKOUT_DURATION`, `MIN_TIME_BETWEEN_ATTEMPTS`

## Security Contact

For security concerns or vulnerabilities, please contact the development team.

---

**Last Updated**: 2024
**Version**: 1.0
