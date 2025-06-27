# Google OAuth Setup Instructions

This guide will help you configure Google OAuth authentication for the File Browser application.

## Prerequisites

- Google account
- Google Cloud Console access
- Node.js application already installed

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API (or Google People API)

## Step 2: Configure OAuth Consent Screen

1. In the Google Cloud Console, navigate to **APIs & Services > OAuth consent screen**
2. Choose **External** user type (unless you have a Google Workspace account)
3. Fill in the required information:
   - **App name**: File Browser
   - **User support email**: Your email
   - **Developer contact information**: Your email
4. Add scopes:
   - `../auth/userinfo.email`
   - `../auth/userinfo.profile`
5. Save and continue

## Step 3: Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth 2.0 Client IDs**
3. Choose **Web application**
4. Configure the settings:
   - **Name**: File Browser OAuth Client
   - **Authorized JavaScript origins**: 
     - `http://localhost:3000` (for development)
     - Your production URL (if applicable)
   - **Authorized redirect URIs**:
     - `http://localhost:3000/auth/google/callback` (for development)
     - Your production callback URL (if applicable)
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

## Step 4: Configure Environment Variables

1. Create a `.env` file in your project root (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file with your credentials:
   ```env
   GOOGLE_CLIENT_ID=your_google_client_id_here
   GOOGLE_CLIENT_SECRET=your_google_client_secret_here
   SESSION_SECRET=your_random_session_secret_here
   PORT=3000
   BASE_URL=http://localhost:3000
   ```

3. For the session secret, generate a random string:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

## Step 5: Install Dependencies

Make sure you have installed the authentication dependencies:

```bash
npm install
```

## Step 6: Test the Authentication

1. Start the application:
   ```bash
   npm start
   ```

2. Open your browser and navigate to `http://localhost:3000`

3. You should see a Google Sign-In button

4. Click the button and authorize the application

5. You should be redirected back to the file browser with your user info displayed

## Production Deployment

For production deployment:

1. Update your Google OAuth settings:
   - Add your production domain to **Authorized JavaScript origins**
   - Add your production callback URL to **Authorized redirect URIs**

2. Update your `.env` file:
   - Set `BASE_URL` to your production URL
   - Use HTTPS for secure cookies
   - Generate a strong session secret

3. Enable secure cookies by setting `cookie.secure: true` in the session configuration when using HTTPS

## Troubleshooting

### Common Issues

1. **"redirect_uri_mismatch" error**:
   - Check that your callback URL exactly matches what's configured in Google Cloud Console
   - Make sure you're using the correct protocol (http vs https)

2. **"invalid_client" error**:
   - Verify your Client ID and Client Secret are correct
   - Check that the OAuth consent screen is configured properly

3. **Session not persisting**:
   - Make sure you have a strong session secret
   - Check that cookies are being set properly
   - Verify session middleware is configured correctly

4. **"Authentication required" loop**:
   - Check that your environment variables are loaded correctly
   - Verify the Passport strategy is configured properly

### Debug Mode

To enable debug logging, set the following environment variable:

```bash
DEBUG=passport:* npm start
```

This will show detailed authentication flow information.

## Security Notes

- Never commit your `.env` file to version control
- Use strong, unique session secrets
- Enable HTTPS in production
- Regularly rotate your OAuth credentials
- Consider implementing user session timeouts for additional security

## Additional Configuration

### Custom User Data

You can modify the `auth.js` file to store additional user information or integrate with a database for persistent user management.

### Session Storage

For production deployments with multiple servers, consider using a session store like Redis:

```bash
npm install connect-redis redis
```

Then update your session configuration in `server.js`.