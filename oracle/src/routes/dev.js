import express from 'express';
import { ethers } from 'ethers';
import { getAthleteStats, fetchParticipantMileage } from '../strava-client.js';
import { query } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const devRouter = express.Router();

// Only enable in development
const isDev = process.env.NODE_ENV === 'development';
const USE_MOCK = process.env.MOCK_STRAVA === 'true';

/**
 * GET /dev/mock-status
 * Check if the oracle is running in mock mode
 */
devRouter.get('/mock-status', async (req, res) => {
  res.json({
    mockMode: USE_MOCK,
    development: isDev
  });
});

/**
 * POST /dev/sync-from-chain
 * Sync challenge and participant data from blockchain to database
 * This reads the contract state and populates the oracle database
 */
devRouter.post('/sync-from-chain', async (req, res) => {
  if (!isDev) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    // Load contract ABI
    const contractArtifactPath = path.join(__dirname, '../../../artifacts/contracts/StravaChallenge.sol/StravaChallenge.json');
    const contractArtifact = JSON.parse(fs.readFileSync(contractArtifactPath, 'utf8'));

    // Connect to blockchain
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS,
      contractArtifact.abi,
      provider
    );

    // Get total challenge count
    const challengeCount = await contract.getChallengeCount();
    console.log(`Syncing ${challengeCount} challenges from chain...`);

    let challengesSynced = 0;
    let participantsSynced = 0;

    // Sync each challenge
    for (let i = 0; i < challengeCount; i++) {
      const challengeData = await contract.challenges(i);

      // Insert or update challenge (normalize addresses to lowercase)
      await query(
        `INSERT INTO challenges
         (id, creator, start_time, end_time, stake_amount, total_staked, state, winner, participant_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           total_staked = EXCLUDED.total_staked,
           state = EXCLUDED.state,
           winner = EXCLUDED.winner,
           participant_count = EXCLUDED.participant_count,
           updated_at = CURRENT_TIMESTAMP`,
        [
          i,
          challengeData.creator.toLowerCase(),
          Number(challengeData.startTime),
          Number(challengeData.endTime),
          challengeData.stakeAmount.toString(),
          challengeData.totalStaked.toString(),
          'PENDING', // We'll calculate state from contract
          challengeData.winner.toLowerCase(),
          Number(challengeData.participantCount)
        ]
      );
      challengesSynced++;

      // Get participants for this challenge
      const participantAddresses = await contract.getParticipants(i);

      for (const address of participantAddresses) {
        const participantData = await contract.getParticipant(i, address);

        // Insert or update participant (normalize address to lowercase)
        await query(
          `INSERT INTO participants
           (challenge_id, wallet_address, strava_user_id, has_joined, stake_paid)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (challenge_id, wallet_address) DO UPDATE SET
             strava_user_id = EXCLUDED.strava_user_id,
             has_joined = EXCLUDED.has_joined,
             stake_paid = EXCLUDED.stake_paid`,
          [
            i,
            address.toLowerCase(),
            participantData.stravaUserId,
            participantData.hasJoined,
            participantData.hasJoined // Assume if joined, stake was paid
          ]
        );
        participantsSynced++;
      }
    }

    console.log(`Sync complete: ${challengesSynced} challenges, ${participantsSynced} participants`);

    res.json({
      success: true,
      challengesSynced,
      participantsSynced,
      message: 'Blockchain data synced to database'
    });

  } catch (error) {
    console.error('Sync from chain error:', error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

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

/**
 * POST /dev/set-mileage
 * Manually set mileage for a participant (MOCK_STRAVA mode only)
 *
 * Body:
 * {
 *   "challengeId": 0,
 *   "walletAddress": "0x...",
 *   "miles": 10.5
 * }
 */
devRouter.post('/set-mileage', async (req, res) => {
  if (!isDev) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!USE_MOCK) {
    return res.status(400).json({
      error: 'This endpoint only works when MOCK_STRAVA=true',
      hint: 'Set MOCK_STRAVA=true in your .env file to use mock mode'
    });
  }

  try {
    const { challengeId, walletAddress, miles } = req.body;

    // Validate inputs
    if (challengeId === undefined || challengeId === null) {
      return res.status(400).json({ error: 'challengeId is required' });
    }

    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (miles === undefined || miles === null || isNaN(parseFloat(miles))) {
      return res.status(400).json({ error: 'miles must be a number' });
    }

    const mileageValue = parseFloat(miles);

    // Normalize wallet address to lowercase for case-insensitive comparison
    const normalizedAddress = walletAddress.toLowerCase();

    // Get participant's Strava user ID
    const participantResult = await query(
      'SELECT strava_user_id FROM participants WHERE challenge_id = $1 AND LOWER(wallet_address) = $2',
      [challengeId, normalizedAddress]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Participant not found for this challenge',
        hint: 'Make sure the participant has joined the challenge and run /dev/sync-from-chain',
        debugInfo: {
          challengeId,
          walletAddress: walletAddress.toLowerCase()
        }
      });
    }

    let stravaUserId = participantResult.rows[0].strava_user_id;

    // If no Strava ID in database, generate a mock one (for testing)
    if (!stravaUserId && USE_MOCK) {
      const { getMockStravaId } = await import('../mock-strava.js');
      stravaUserId = getMockStravaId(walletAddress);
      console.log(`[MOCK] Generated Strava ID for ${walletAddress}: ${stravaUserId}`);

      // Update participant with the mock Strava ID
      await query(
        'UPDATE participants SET strava_user_id = $1 WHERE challenge_id = $2 AND LOWER(wallet_address) = $3',
        [stravaUserId, challengeId, normalizedAddress]
      );
    }

    // Insert mileage snapshot (use normalized address for consistency)
    await query(
      `INSERT INTO mileage_snapshots
       (challenge_id, wallet_address, strava_user_id, total_miles, raw_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        challengeId,
        normalizedAddress,
        stravaUserId,
        mileageValue,
        JSON.stringify({ mock: true, activities: [] })
      ]
    );

    console.log(`[MOCK] Set mileage: challenge=${challengeId}, wallet=${walletAddress}, miles=${mileageValue}`);

    res.json({
      success: true,
      challengeId,
      walletAddress,
      miles: mileageValue,
      message: 'Mock mileage set successfully'
    });

  } catch (error) {
    console.error('Set mileage error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});
