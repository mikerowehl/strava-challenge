import express from 'express';
import axios from 'axios';
import { query } from '../db.js';

export const stravaRouter = express.Router();

const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';

/**
 * GET /auth/strava
 * Initiate Strava OAuth flow
 *
 * Query params:
 * - walletAddress: User's Ethereum address (required)
 * - challengeId: Challenge they're joining (optional, for context)
 */
stravaRouter.get('/', (req, res) => {
  try {
    const { walletAddress, challengeId } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    // Validate wallet address format (basic check)
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const redirectUri = process.env.STRAVA_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return res.status(500).json({ error: 'Strava API not configured' });
    }

    // Build state parameter to pass wallet address and challenge ID through OAuth flow
    const state = JSON.stringify({
      walletAddress,
      challengeId: challengeId || null
    });

    // Build authorization URL
    const authUrl = new URL(STRAVA_AUTHORIZE_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'activity:read_all');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('approval_prompt', 'auto');

    // Redirect to Strava
    res.redirect(authUrl.toString());

  } catch (error) {
    console.error('Strava OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /auth/strava/callback
 * Handle Strava OAuth callback
 *
 * Strava redirects here with:
 * - code: Authorization code (exchange for tokens)
 * - scope: Granted permissions
 * - state: Our state parameter (wallet address + challenge ID)
 */
stravaRouter.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth error (user denied)
    if (error) {
      return res.status(400).send(`
        <html>
          <body>
            <h1>Authorization Denied</h1>
            <p>You denied access to your Strava account.</p>
            <p>You need to authorize Strava access to participate in challenges.</p>
          </body>
        </html>
      `);
    }

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }

    // Parse state
    let stateData;
    try {
      stateData = JSON.parse(state);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    const { walletAddress, challengeId } = stateData;

    // Exchange authorization code for tokens
    const tokenResponse = await axios.post(STRAVA_TOKEN_URL, {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code'
    });

    const {
      access_token,
      refresh_token,
      expires_at,
      athlete
    } = tokenResponse.data;

    const stravaUserId = athlete.id.toString();

    // Store tokens in database
    await query(
      `INSERT INTO strava_tokens
       (wallet_address, strava_user_id, access_token, refresh_token, expires_at, athlete_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (wallet_address)
       DO UPDATE SET
         strava_user_id = EXCLUDED.strava_user_id,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         athlete_data = EXCLUDED.athlete_data,
         updated_at = CURRENT_TIMESTAMP`,
      [walletAddress, stravaUserId, access_token, refresh_token, expires_at, JSON.stringify(athlete)]
    );

    console.log(`Strava connected: wallet=${walletAddress}, stravaId=${stravaUserId}`);

    // Return success page with Strava user ID
    res.send(`
      <html>
        <head>
          <style>
            body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            h1 { color: #fc4c02; }
            .info { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
            code { background: #333; color: #0f0; padding: 2px 6px; border-radius: 3px; }
          </style>
        </head>
        <body>
          <h1>Strava Connected Successfully</h1>
          <div class="info">
            <p><strong>Wallet Address:</strong> <code>${walletAddress}</code></p>
            <p><strong>Strava User ID:</strong> <code>${stravaUserId}</code></p>
            <p><strong>Athlete Name:</strong> ${athlete.firstname} ${athlete.lastname}</p>
          </div>
          <p>You can now use this Strava User ID when joining a challenge on-chain.</p>
          ${challengeId ? `<p>Challenge ID: ${challengeId}</p>` : ''}
          <p>You can close this window and return to the application.</p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Strava OAuth callback error:', error);

    // Return user-friendly error page
    res.status(500).send(`
      <html>
        <body>
          <h1>Authentication Failed</h1>
          <p>There was an error connecting your Strava account.</p>
          <p>Error: ${error.message}</p>
          <p>Please try again.</p>
        </body>
      </html>
    `);
  }
});

/**
 * GET /auth/strava/status/:walletAddress
 * Check if a wallet has connected their Strava account
 */
stravaRouter.get('/status/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const result = await query(
      'SELECT strava_user_id, athlete_data, updated_at FROM strava_tokens WHERE wallet_address = $1',
      [walletAddress]
    );

    if (result.rows.length === 0) {
      return res.json({
        connected: false,
        walletAddress
      });
    }

    const token = result.rows[0];
    const athleteData = JSON.parse(token.athlete_data);

    res.json({
      connected: true,
      walletAddress,
      stravaUserId: token.strava_user_id,
      athleteName: `${athleteData.firstname} ${athleteData.lastname}`,
      connectedAt: token.updated_at
    });

  } catch (error) {
    console.error('Strava status check error:', error);
    res.status(500).json({ error: error.message });
  }
});
