import express from 'express';
import { query } from '../db.js';

export const challengesRouter = express.Router();

/**
 * GET /challenges
 * List all challenges
 */
challengesRouter.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM challenges ORDER BY id DESC'
    );
    res.json({ challenges: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /challenges/:id
 * Get challenge details
 */
challengesRouter.get('/:id', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);

    if (isNaN(challengeId)) {
      return res.status(400).json({ error: 'Invalid challenge ID' });
    }

    const result = await query(
      'SELECT * FROM challenges WHERE id = $1',
      [challengeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    res.json({ challenge: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /challenges/:id/leaderboard
 * Get current leaderboard for a challenge
 * (Enhanced in Checkpoint 2.3)
 */
challengesRouter.get('/:id/leaderboard', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);

    if (isNaN(challengeId)) {
      return res.status(400).json({ error: 'Invalid challenge ID' });
    }

    // Get latest mileage snapshot for each participant
    const result = await query(
      `SELECT m.wallet_address, m.strava_user_id, m.total_miles, m.snapshot_at
       FROM mileage_snapshots m
       WHERE m.challenge_id = $1
       AND m.id IN (
         SELECT MAX(id) FROM mileage_snapshots
         WHERE challenge_id = $1
         GROUP BY wallet_address
       )
       ORDER BY m.total_miles DESC`,
      [challengeId]
    );

    res.json({
      challengeId,
      leaderboard: result.rows.map((row, index) => ({
        rank: index + 1,
        address: row.wallet_address,
        stravaUserId: row.strava_user_id,
        miles: parseFloat(row.total_miles),
        lastUpdate: row.snapshot_at
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /challenges/:id/sync
 * Manually trigger a sync for a challenge
 * (To be implemented in Checkpoint 2.3)
 */
challengesRouter.post('/:id/sync', async (req, res) => {
  res.status(501).json({
    message: 'Manual sync not yet implemented',
    checkpoint: '2.3'
  });
});
