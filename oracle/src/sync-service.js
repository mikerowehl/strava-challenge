import { query } from './db.js';
import { fetchParticipantMileage } from './strava-client.js';

/**
 * Sync mileage for all participants in a challenge
 * Creates snapshots in the database
 */
export async function syncChallengeParticipants(challengeId) {
  try {
    // Get challenge details
    const challengeResult = await query(
      'SELECT * FROM challenges WHERE id = $1',
      [challengeId]
    );

    if (challengeResult.rows.length === 0) {
      throw new Error(`Challenge ${challengeId} not found`);
    }

    const challenge = challengeResult.rows[0];
    const now = Math.floor(Date.now() / 1000);

    // Get all participants who have connected Strava
    const participantsResult = await query(
      `SELECT p.wallet_address, p.strava_user_id
       FROM participants p
       JOIN strava_tokens st ON p.wallet_address = st.wallet_address
       WHERE p.challenge_id = $1 AND p.strava_user_id IS NOT NULL`,
      [challengeId]
    );

    if (participantsResult.rows.length === 0) {
      console.log(`No participants with Strava tokens for challenge ${challengeId}`);
      return {
        challengeId,
        synced: 0,
        errors: 0,
        message: 'No participants with Strava tokens'
      };
    }

    const participants = participantsResult.rows;
    let synced = 0;
    let errors = 0;

    // Use current time or challenge end time, whichever is earlier
    const endTime = Math.min(now, challenge.end_time);

    for (const participant of participants) {
      try {
        // Fetch mileage from Strava
        const mileageData = await fetchParticipantMileage(
          participant.wallet_address,
          challenge.start_time,
          endTime
        );

        // Store snapshot
        await query(
          `INSERT INTO mileage_snapshots
           (challenge_id, wallet_address, strava_user_id, total_miles, raw_data)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            challengeId,
            participant.wallet_address,
            participant.strava_user_id,
            mileageData.miles,
            JSON.stringify(mileageData.rawActivities)
          ]
        );

        console.log(`Synced ${participant.wallet_address}: ${mileageData.miles} miles (${mileageData.activityCount} activities)`);
        synced++;

      } catch (error) {
        console.error(`Failed to sync ${participant.wallet_address}:`, error.message);
        errors++;
      }
    }

    return {
      challengeId,
      synced,
      errors,
      total: participants.length
    };

  } catch (error) {
    console.error(`Sync failed for challenge ${challengeId}:`, error);
    throw error;
  }
}

/**
 * Sync all active challenges
 * Called by the hourly cron job
 */
export async function syncActiveChallenges() {
  try {
    const now = Math.floor(Date.now() / 1000);

    // Get all challenges that are currently active
    // (started but not yet ended)
    const challengesResult = await query(
      `SELECT id FROM challenges
       WHERE start_time <= $1 AND end_time > $1
       ORDER BY id`,
      [now]
    );

    const challenges = challengesResult.rows;

    if (challenges.length === 0) {
      console.log('No active challenges to sync');
      return {
        activeChallenges: 0,
        results: []
      };
    }

    console.log(`Syncing ${challenges.length} active challenge(s)`);

    const results = [];

    for (const challenge of challenges) {
      try {
        const result = await syncChallengeParticipants(challenge.id);
        results.push(result);
      } catch (error) {
        console.error(`Failed to sync challenge ${challenge.id}:`, error.message);
        results.push({
          challengeId: challenge.id,
          error: error.message
        });
      }
    }

    return {
      activeChallenges: challenges.length,
      results
    };

  } catch (error) {
    console.error('Sync active challenges failed:', error);
    throw error;
  }
}
