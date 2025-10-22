import express from 'express';
import { ethers } from 'ethers';
import { query } from '../db.js';

export const participantsRouter = express.Router();

/**
 * POST /participants/confirm
 * Participant confirms their mileage for a challenge
 *
 * During the grace period after a challenge ends, participants should
 * sign a message confirming their final mileage. This allows the oracle
 * to finalize early if all participants have confirmed.
 *
 * Body:
 * {
 *   "challengeId": 0,
 *   "walletAddress": "0x...",
 *   "signature": "0x..."  // Signature of message: "CONFIRM_CHALLENGE_{challengeId}"
 * }
 */
participantsRouter.post('/confirm', async (req, res) => {
  try {
    const { challengeId, walletAddress, signature } = req.body;

    // Validate inputs
    if (challengeId === undefined || challengeId === null) {
      return res.status(400).json({ error: 'challengeId is required' });
    }

    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (!signature || !signature.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Check if challenge exists
    const challengeResult = await query(
      'SELECT * FROM challenges WHERE id = $1',
      [challengeId]
    );

    if (challengeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = challengeResult.rows[0];
    const now = Math.floor(Date.now() / 1000);

    // Check if challenge has ended
    if (now < challenge.end_time) {
      return res.status(400).json({
        error: 'Challenge has not ended yet',
        endTime: challenge.end_time,
        currentTime: now
      });
    }

    // Check if participant exists
    const participantResult = await query(
      'SELECT * FROM participants WHERE challenge_id = $1 AND wallet_address = $2',
      [challengeId, walletAddress]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found for this challenge' });
    }

    const participant = participantResult.rows[0];

    if (participant.confirmed) {
      return res.status(400).json({
        error: 'Already confirmed',
        confirmedAt: participant.joined_at
      });
    }

    // Verify signature
    const message = `CONFIRM_CHALLENGE_${challengeId}`;
    const messageHash = ethers.hashMessage(message);

    let recoveredAddress;
    try {
      recoveredAddress = ethers.recoverAddress(messageHash, signature);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid signature format' });
    }

    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(400).json({
        error: 'Signature does not match wallet address',
        expected: walletAddress,
        recovered: recoveredAddress
      });
    }

    // Update participant confirmation status
    await query(
      'UPDATE participants SET confirmed = TRUE WHERE challenge_id = $1 AND wallet_address = $2',
      [challengeId, walletAddress]
    );

    console.log(`Participant confirmed: challenge=${challengeId}, wallet=${walletAddress}`);

    // Check if all participants have now confirmed
    const allParticipantsResult = await query(
      'SELECT COUNT(*) as total, SUM(CASE WHEN confirmed THEN 1 ELSE 0 END) as confirmed FROM participants WHERE challenge_id = $1',
      [challengeId]
    );

    const stats = allParticipantsResult.rows[0];
    const allConfirmed = parseInt(stats.total) === parseInt(stats.confirmed);

    res.json({
      success: true,
      challengeId,
      walletAddress,
      confirmed: true,
      allParticipantsConfirmed: allConfirmed,
      confirmationStats: {
        total: parseInt(stats.total),
        confirmed: parseInt(stats.confirmed)
      }
    });

  } catch (error) {
    console.error('Participant confirmation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /participants/:challengeId
 * Get all participants for a challenge with their confirmation status
 */
participantsRouter.get('/:challengeId', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.challengeId);

    if (isNaN(challengeId)) {
      return res.status(400).json({ error: 'Invalid challenge ID' });
    }

    const result = await query(
      `SELECT p.wallet_address, p.strava_user_id, p.confirmed, p.joined_at,
              m.total_miles, m.snapshot_at
       FROM participants p
       LEFT JOIN LATERAL (
         SELECT total_miles, snapshot_at
         FROM mileage_snapshots
         WHERE challenge_id = p.challenge_id AND wallet_address = p.wallet_address
         ORDER BY id DESC
         LIMIT 1
       ) m ON true
       WHERE p.challenge_id = $1
       ORDER BY p.joined_at`,
      [challengeId]
    );

    const participants = result.rows.map(row => ({
      walletAddress: row.wallet_address,
      stravaUserId: row.strava_user_id,
      confirmed: row.confirmed,
      joinedAt: row.joined_at,
      currentMiles: row.total_miles ? parseFloat(row.total_miles) : 0,
      lastUpdate: row.snapshot_at
    }));

    const totalParticipants = participants.length;
    const confirmedCount = participants.filter(p => p.confirmed).length;

    res.json({
      challengeId,
      participants,
      stats: {
        total: totalParticipants,
        confirmed: confirmedCount,
        allConfirmed: totalParticipants === confirmedCount
      }
    });

  } catch (error) {
    console.error('Get participants error:', error);
    res.status(500).json({ error: error.message });
  }
});
