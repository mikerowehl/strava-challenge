import { createHash } from 'crypto';
import { query } from './db.js';

/**
 * Mock Strava client for testing
 *
 * When MOCK_STRAVA=true, this module replaces the real Strava API client.
 * It provides the same interface but doesn't make external API calls.
 */

/**
 * Generate a fake Strava user ID from wallet address
 * This ensures the same wallet always gets the same mock Strava ID
 */
function generateMockStravaId(walletAddress) {
  const hash = createHash('sha256').update(walletAddress.toLowerCase()).digest('hex');
  // Take first 8 digits as a mock Strava user ID
  return parseInt(hash.substring(0, 8), 16).toString();
}

/**
 * Mock: Fetch activities for an athlete within a time range
 * Returns empty array since we'll set mileage manually via API
 */
export async function fetchActivities(walletAddress, afterTimestamp, beforeTimestamp) {
  console.log(`[MOCK] fetchActivities for ${walletAddress}`);
  return [];
}

/**
 * Mock: Calculate total running distance in miles for activities
 * Returns 0 since mock activities are empty
 */
export function calculateTotalMiles(activities) {
  return 0;
}

/**
 * Mock: Fetch mileage for a participant in a challenge
 * Returns the latest mileage snapshot from database, or 0 if none exists
 */
export async function fetchParticipantMileage(walletAddress, challengeStartTime, challengeEndTime) {
  console.log(`[MOCK] fetchParticipantMileage for ${walletAddress}`);

  // Get the most recent mileage snapshot for this wallet
  // This allows the /dev/set-mileage endpoint to control the values
  const result = await query(
    `SELECT total_miles
     FROM mileage_snapshots
     WHERE wallet_address = $1
     ORDER BY snapshot_at DESC
     LIMIT 1`,
    [walletAddress]
  );

  const miles = result.rows.length > 0 ? parseFloat(result.rows[0].total_miles) : 0;

  return {
    miles: miles,
    activityCount: 0,
    rawActivities: []
  };
}

/**
 * Mock: Get athlete stats
 * Returns fake athlete data based on wallet address
 */
export async function getAthleteStats(walletAddress) {
  console.log(`[MOCK] getAthleteStats for ${walletAddress}`);

  const mockStravaId = generateMockStravaId(walletAddress);

  return {
    id: parseInt(mockStravaId),
    username: `mock_user_${walletAddress.substring(2, 8)}`,
    firstname: 'Mock',
    lastname: 'User',
    city: 'Test City',
    state: 'Test State',
    country: 'Test Country',
    sex: 'M',
    premium: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Generate mock Strava ID for external use
 * This is exported so other parts of the system can generate consistent mock IDs
 */
export function getMockStravaId(walletAddress) {
  return generateMockStravaId(walletAddress);
}
