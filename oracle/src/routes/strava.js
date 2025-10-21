import express from 'express';

export const stravaRouter = express.Router();

/**
 * GET /auth/strava
 * Initiate Strava OAuth flow
 * (To be implemented in Checkpoint 2.2)
 */
stravaRouter.get('/', (req, res) => {
  res.status(501).json({
    message: 'Strava OAuth not yet implemented',
    checkpoint: '2.2'
  });
});

/**
 * GET /auth/strava/callback
 * Handle Strava OAuth callback
 * (To be implemented in Checkpoint 2.2)
 */
stravaRouter.get('/callback', (req, res) => {
  res.status(501).json({
    message: 'Strava OAuth callback not yet implemented',
    checkpoint: '2.2'
  });
});
