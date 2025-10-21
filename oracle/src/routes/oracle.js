import express from 'express';
import { ethers } from 'ethers';
import { signFinalization, getOracleAddress } from '../wallet.js';
import { query } from '../db.js';

export const oracleRouter = express.Router();

const GRACE_PERIOD_DAYS = 7;

/**
 * GET /oracle/address
 * Get the oracle's Ethereum address
 */
oracleRouter.get('/address', (req, res) => {
  try {
    const address = getOracleAddress();
    res.json({ address });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /oracle/challenge/:id/finalization
 * Get finalization signature for a challenge
 *
 * Oracle will only sign if:
 * 1. Challenge has ended (current time >= end_time)
 * 2. Either:
 *    a) 7 days have passed since end (grace period expired), OR
 *    b) All participants have confirmed their mileage
 *
 * Returns signature that winner can use to claim prize on-chain
 */
oracleRouter.get('/challenge/:id/finalization', async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);

    if (isNaN(challengeId)) {
      return res.status(400).json({ error: 'Invalid challenge ID' });
    }

    // Get challenge details
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
        error: 'Challenge has not ended',
        endTime: challenge.end_time,
        currentTime: now,
        timeRemaining: challenge.end_time - now
      });
    }

    // Calculate time since end
    const timeSinceEnd = now - challenge.end_time;
    const gracePeriodSeconds = GRACE_PERIOD_DAYS * 24 * 60 * 60;

    // Get all participants for this challenge
    const participantsResult = await query(
      'SELECT wallet_address, confirmed FROM participants WHERE challenge_id = $1',
      [challengeId]
    );

    if (participantsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No participants found for this challenge' });
    }

    const totalParticipants = participantsResult.rows.length;
    const confirmedParticipants = participantsResult.rows.filter(p => p.confirmed).length;
    const allConfirmed = confirmedParticipants === totalParticipants;

    // Check if we can finalize:
    // Either grace period expired OR all participants confirmed
    const gracePeriodExpired = timeSinceEnd >= gracePeriodSeconds;
    const canFinalize = gracePeriodExpired || allConfirmed;

    if (!canFinalize) {
      return res.status(400).json({
        error: 'Cannot finalize yet',
        reason: 'Grace period not expired and not all participants confirmed',
        gracePeriodExpired,
        allConfirmed,
        confirmedCount: confirmedParticipants,
        totalParticipants,
        timeSinceEnd,
        gracePeriodSeconds,
        timeUntilCanFinalize: gracePeriodSeconds - timeSinceEnd
      });
    }

    // Get latest mileage for all participants
    const mileageResult = await query(
      `SELECT m.wallet_address, m.strava_user_id, m.total_miles, p.confirmed
       FROM mileage_snapshots m
       JOIN participants p ON m.challenge_id = p.challenge_id AND m.wallet_address = p.wallet_address
       WHERE m.challenge_id = $1
       AND m.id IN (
         SELECT MAX(id) FROM mileage_snapshots
         WHERE challenge_id = $1
         GROUP BY wallet_address
       )
       ORDER BY m.total_miles DESC`,
      [challengeId]
    );

    if (mileageResult.rows.length === 0) {
      return res.status(400).json({ error: 'No mileage data found for participants' });
    }

    // Determine winner (most miles)
    const winner = mileageResult.rows[0];
    const allParticipantsData = mileageResult.rows;

    // Create data hash from results
    // This is a deterministic representation of the final results
    const resultsData = allParticipantsData.map(p => ({
      address: p.wallet_address,
      stravaUserId: p.strava_user_id,
      miles: parseFloat(p.total_miles),
      confirmed: p.confirmed
    }));

    const resultsString = JSON.stringify(resultsData);
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes(resultsString));

    // Generate signature
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signFinalization(
      challengeId,
      winner.wallet_address,
      dataHash,
      timestamp
    );

    res.json({
      challengeId,
      winner: {
        address: winner.wallet_address,
        stravaUserId: winner.strava_user_id,
        miles: parseFloat(winner.total_miles),
        confirmed: winner.confirmed
      },
      participants: resultsData,
      finalizationReason: allConfirmed ? 'all_confirmed' : 'grace_period_expired',
      confirmedCount: confirmedParticipants,
      totalParticipants,
      dataHash,
      timestamp,
      signature,
      oracleAddress: getOracleAddress(),
      // Include full results for transparency
      fullResults: resultsString
    });

  } catch (error) {
    console.error('Get finalization error:', error);
    res.status(500).json({ error: error.message });
  }
});
