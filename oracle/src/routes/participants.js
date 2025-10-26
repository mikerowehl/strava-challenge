import express from 'express';
import { ethers } from 'ethers';
import { query } from '../db.js';
import { getBlockchainTime } from '../event-listener.js';

export const participantsRouter = express.Router();

/**
 * POST /participants/confirm
 * Participant confirms their mileage for a challenge
 *
 * During the grace period after a challenge ends, participants should
 * sign a message confirming their final mileage. This allows the oracle
 * to finalize early if all participants have confirmed.
 *
 * The signature is stored in the database to provide a verifiable audit trail.
 * Anyone can later verify that each participant cryptographically confirmed
 * their data, reducing trust requirements in the oracle.
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
    const now = await getBlockchainTime();

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

    // Update participant confirmation status with signature and timestamp
    await query(
      `UPDATE participants
       SET confirmed = TRUE,
           confirmation_signature = $3,
           confirmed_at = CURRENT_TIMESTAMP
       WHERE challenge_id = $1 AND wallet_address = $2`,
      [challengeId, walletAddress, signature]
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
 * POST /participants/verify-signature
 * Verify a stored confirmation signature
 *
 * Allows anyone to verify that a participant's confirmation signature is valid.
 * This provides transparency and reduces trust in the oracle.
 *
 * Body:
 * {
 *   "challengeId": 0,
 *   "walletAddress": "0x..."
 * }
 *
 * Returns the stored signature and verification result.
 */
participantsRouter.post('/verify-signature', async (req, res) => {
  try {
    const { challengeId, walletAddress } = req.body;

    if (challengeId === undefined || challengeId === null) {
      return res.status(400).json({ error: 'challengeId is required' });
    }

    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Get participant confirmation data
    const result = await query(
      `SELECT confirmation_signature, confirmed_at, confirmed
       FROM participants
       WHERE challenge_id = $1 AND wallet_address = $2`,
      [challengeId, walletAddress]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const participant = result.rows[0];

    if (!participant.confirmed || !participant.confirmation_signature) {
      return res.json({
        confirmed: false,
        message: 'Participant has not confirmed yet'
      });
    }

    // Verify the signature
    const message = `CONFIRM_CHALLENGE_${challengeId}`;
    let recoveredAddress;
    let isValid = false;

    try {
      const messageHash = ethers.hashMessage(message);
      recoveredAddress = ethers.recoverAddress(messageHash, participant.confirmation_signature);
      isValid = recoveredAddress.toLowerCase() === walletAddress.toLowerCase();
    } catch (error) {
      return res.json({
        confirmed: true,
        signature: participant.confirmation_signature,
        confirmedAt: participant.confirmed_at,
        isValid: false,
        error: 'Invalid signature format'
      });
    }

    res.json({
      confirmed: true,
      signature: participant.confirmation_signature,
      confirmedAt: participant.confirmed_at,
      message: message,
      recoveredAddress: recoveredAddress,
      expectedAddress: walletAddress,
      isValid: isValid
    });

  } catch (error) {
    console.error('Signature verification error:', error);
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
              p.confirmation_signature, p.confirmed_at,
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
      confirmationSignature: row.confirmation_signature,
      confirmedAt: row.confirmed_at,
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
