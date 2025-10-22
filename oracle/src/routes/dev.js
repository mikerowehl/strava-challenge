import express from 'express';
import { getAthleteStats, fetchParticipantMileage } from '../strava-client.js';
import { query } from '../db.js';

export const devRouter = express.Router();

// Only enable in development
const isDev = process.env.NODE_ENV === 'development';

/**
 * GET /dev/strava-test/:walletAddress
 * Test Strava API connection for a wallet
 *
 * This endpoint verifies:
 * 1. Token exists in database
 * 2. Token can be refreshed if needed
 * 3. Can fetch athlete data from Strava
 */
devRouter.get('/strava-test/:walletAddress', async (req, res) => {
  if (!isDev) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const { walletAddress } = req.params;

    // Check if token exists
    const tokenResult = await query(
      'SELECT strava_user_id, expires_at, created_at FROM strava_tokens WHERE wallet_address = $1',
      [walletAddress]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No Strava token found for this wallet',
        walletAddress,
        hint: `Visit http://localhost:3000/auth/strava?walletAddress=${walletAddress} to connect Strava`
      });
    }

    const token = tokenResult.rows[0];
    const now = Math.floor(Date.now() / 1000);
    const tokenExpired = token.expires_at <= now;

    // Try to fetch athlete data (will auto-refresh if needed)
    const athlete = await getAthleteStats(walletAddress);

    res.json({
      success: true,
      walletAddress,
      stravaUserId: token.strava_user_id,
      tokenInfo: {
        expiresAt: token.expires_at,
        wasExpired: tokenExpired,
        createdAt: token.created_at
      },
      athlete: {
        id: athlete.id,
        username: athlete.username,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        city: athlete.city,
        state: athlete.state,
        country: athlete.country
      }
    });

  } catch (error) {
    console.error('Strava test error:', error);
    res.status(500).json({
      error: error.message,
      hint: 'Check that STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are set correctly'
    });
  }
});

/**
 * GET /dev/fetch-activities/:walletAddress
 * Test fetching activities for a wallet
 *
 * Query params:
 * - days: Number of days back to fetch (default: 30)
 */
devRouter.get('/fetch-activities/:walletAddress', async (req, res) => {
  if (!isDev) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const { walletAddress } = req.params;
    const days = parseInt(req.query.days) || 30;

    const now = Math.floor(Date.now() / 1000);
    const startTime = now - (days * 24 * 60 * 60);

    // Fetch mileage
    const result = await fetchParticipantMileage(walletAddress, startTime, now);

    res.json({
      success: true,
      walletAddress,
      period: {
        days,
        startTime,
        endTime: now
      },
      result: {
        totalMiles: result.miles,
        activityCount: result.activityCount,
        activities: result.rawActivities.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          distance: a.distance,
          distanceMiles: (a.distance * 0.000621371).toFixed(2),
          startDate: a.start_date,
          movingTime: a.moving_time,
          elapsedTime: a.elapsed_time
        }))
      }
    });

  } catch (error) {
    console.error('Fetch activities error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * GET /dev/db-status
 * Check database connection and show table stats
 */
devRouter.get('/db-status', async (req, res) => {
  if (!isDev) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const stats = {};

    // Count records in each table
    const challengesCount = await query('SELECT COUNT(*) as count FROM challenges');
    const participantsCount = await query('SELECT COUNT(*) as count FROM participants');
    const tokensCount = await query('SELECT COUNT(*) as count FROM strava_tokens');
    const snapshotsCount = await query('SELECT COUNT(*) as count FROM mileage_snapshots');

    stats.challenges = parseInt(challengesCount.rows[0].count);
    stats.participants = parseInt(participantsCount.rows[0].count);
    stats.stravaTokens = parseInt(tokensCount.rows[0].count);
    stats.mileageSnapshots = parseInt(snapshotsCount.rows[0].count);

    // Get recent snapshots
    const recentSnapshots = await query(
      'SELECT challenge_id, wallet_address, total_miles, snapshot_at FROM mileage_snapshots ORDER BY snapshot_at DESC LIMIT 5'
    );

    res.json({
      success: true,
      tableStats: stats,
      recentSnapshots: recentSnapshots.rows
    });

  } catch (error) {
    console.error('DB status error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});
