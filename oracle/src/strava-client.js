import axios from 'axios';
import { query } from './db.js';
import * as mockStrava from './mock-strava.js';

// Use mock Strava client if MOCK_STRAVA is enabled
const USE_MOCK = process.env.MOCK_STRAVA === 'true';

if (USE_MOCK) {
  console.log('[STRAVA] Running in MOCK mode - using test data instead of real Strava API');
}

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';

// Meters to miles conversion
const METERS_TO_MILES = 0.000621371;

/**
 * Get valid access token for a wallet address
 * Automatically refreshes if expired
 */
async function getValidAccessToken(walletAddress) {
  // Get current token
  const result = await query(
    'SELECT access_token, refresh_token, expires_at FROM strava_tokens WHERE wallet_address = $1',
    [walletAddress]
  );

  if (result.rows.length === 0) {
    throw new Error(`No Strava token found for wallet ${walletAddress}`);
  }

  const token = result.rows[0];
  const now = Math.floor(Date.now() / 1000);

  // Check if token is still valid (with 5 minute buffer)
  if (token.expires_at > now + 300) {
    return token.access_token;
  }

  // Token expired, refresh it
  console.log(`Refreshing Strava token for wallet ${walletAddress}`);

  try {
    const refreshResponse = await axios.post(STRAVA_TOKEN_URL, {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token'
    });

    const {
      access_token,
      refresh_token,
      expires_at
    } = refreshResponse.data;

    // Update tokens in database
    await query(
      `UPDATE strava_tokens
       SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = CURRENT_TIMESTAMP
       WHERE wallet_address = $4`,
      [access_token, refresh_token, expires_at, walletAddress]
    );

    console.log(`Token refreshed for wallet ${walletAddress}`);
    return access_token;

  } catch (error) {
    console.error(`Failed to refresh token for ${walletAddress}:`, error.message);
    throw new Error(`Failed to refresh Strava token: ${error.message}`);
  }
}

/**
 * Fetch activities for an athlete within a time range
 * @param {string} walletAddress - User's wallet address
 * @param {number} afterTimestamp - Unix timestamp (activities after this time)
 * @param {number} beforeTimestamp - Unix timestamp (activities before this time)
 * @returns {Array} Array of activities
 */
export async function fetchActivities(walletAddress, afterTimestamp, beforeTimestamp) {
  if (USE_MOCK) {
    return mockStrava.fetchActivities(walletAddress, afterTimestamp, beforeTimestamp);
  }

  const accessToken = await getValidAccessToken(walletAddress);

  const activities = [];
  let page = 1;
  const perPage = 200; // Max allowed by Strava

  while (true) {
    try {
      const response = await axios.get(`${STRAVA_API_BASE}/athlete/activities`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: {
          after: afterTimestamp,
          before: beforeTimestamp,
          page,
          per_page: perPage
        }
      });

      const pageActivities = response.data;

      if (pageActivities.length === 0) {
        break; // No more activities
      }

      activities.push(...pageActivities);

      // If we got fewer than perPage, we're done
      if (pageActivities.length < perPage) {
        break;
      }

      page++;

    } catch (error) {
      if (error.response?.status === 429) {
        // Rate limited
        throw new Error('Strava API rate limit exceeded');
      }
      throw error;
    }
  }

  return activities;
}

/**
 * Calculate total running distance in miles for activities
 * @param {Array} activities - Array of Strava activities
 * @returns {number} Total miles
 */
export function calculateTotalMiles(activities) {
  if (USE_MOCK) {
    return mockStrava.calculateTotalMiles(activities);
  }

  const runningActivities = activities.filter(a =>
    a.type === 'Run' || a.type === 'VirtualRun'
  );

  const totalMeters = runningActivities.reduce((sum, activity) => {
    return sum + (activity.distance || 0);
  }, 0);

  return totalMeters * METERS_TO_MILES;
}

/**
 * Fetch mileage for a participant in a challenge
 * @param {string} walletAddress - Participant's wallet
 * @param {number} challengeStartTime - Challenge start timestamp
 * @param {number} challengeEndTime - Challenge end timestamp
 * @returns {Object} { miles, activities, rawActivities }
 */
export async function fetchParticipantMileage(walletAddress, challengeStartTime, challengeEndTime) {
  if (USE_MOCK) {
    return mockStrava.fetchParticipantMileage(walletAddress, challengeStartTime, challengeEndTime);
  }

  try {
    const activities = await fetchActivities(walletAddress, challengeStartTime, challengeEndTime);
    const miles = calculateTotalMiles(activities);

    return {
      miles: parseFloat(miles.toFixed(2)),
      activityCount: activities.filter(a => a.type === 'Run' || a.type === 'VirtualRun').length,
      rawActivities: activities
    };

  } catch (error) {
    console.error(`Failed to fetch mileage for ${walletAddress}:`, error.message);
    throw error;
  }
}

/**
 * Get athlete stats (for testing/verification)
 */
export async function getAthleteStats(walletAddress) {
  if (USE_MOCK) {
    return mockStrava.getAthleteStats(walletAddress);
  }

  const accessToken = await getValidAccessToken(walletAddress);

  try {
    const response = await axios.get(`${STRAVA_API_BASE}/athlete`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    return response.data;

  } catch (error) {
    console.error(`Failed to fetch athlete stats for ${walletAddress}:`, error.message);
    throw error;
  }
}
