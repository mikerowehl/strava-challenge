// Oracle API client

const ORACLE_URL = process.env.REACT_APP_ORACLE_URL || 'http://localhost:3000';

// Check if oracle is in mock mode
export async function isMockMode() {
  try {
    const response = await fetch(`${ORACLE_URL}/dev/mock-status`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.mockMode === true;
  } catch (error) {
    console.error('Error checking mock mode:', error);
    return false;
  }
}

// Get oracle Ethereum address
export async function getOracleAddress() {
  const response = await fetch(`${ORACLE_URL}/oracle/address`);
  const data = await response.json();
  return data.address;
}

// Check if wallet has connected Strava
export async function getStravaStatus(walletAddress) {
  const response = await fetch(`${ORACLE_URL}/auth/strava/status/${walletAddress}`);
  return await response.json();
}

// Get Strava OAuth URL
export function getStravaAuthUrl(walletAddress, challengeId = null) {
  const params = new URLSearchParams({ walletAddress });
  if (challengeId !== null) {
    params.append('challengeId', challengeId);
  }
  return `${ORACLE_URL}/auth/strava?${params.toString()}`;
}

// Get challenge leaderboard
export async function getLeaderboard(challengeId) {
  const response = await fetch(`${ORACLE_URL}/challenges/${challengeId}/leaderboard`);
  return await response.json();
}

// Get finalization signature (for winner to claim prize)
export async function getFinalization(challengeId) {
  const response = await fetch(`${ORACLE_URL}/oracle/challenge/${challengeId}/finalization`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get finalization');
  }
  return await response.json();
}

// Confirm participant mileage
export async function confirmMileage(challengeId, walletAddress, signature) {
  const response = await fetch(`${ORACLE_URL}/participants/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      challengeId,
      walletAddress,
      signature
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to confirm mileage');
  }

  return await response.json();
}

// Get challenge details from oracle
export async function getChallengeFromOracle(challengeId) {
  const response = await fetch(`${ORACLE_URL}/challenges/${challengeId}`);
  return await response.json();
}

// List all challenges from oracle
export async function getAllChallenges() {
  const response = await fetch(`${ORACLE_URL}/challenges`);
  return await response.json();
}

// Set mock mileage (MOCK_STRAVA mode only)
export async function setMockMileage(challengeId, walletAddress, miles) {
  const response = await fetch(`${ORACLE_URL}/dev/set-mileage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      challengeId,
      walletAddress,
      miles
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to set mileage');
  }

  return await response.json();
}
