import { ethers } from 'ethers';
import { query } from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let contract = null;
let provider = null;

/**
 * Initialize the event listener
 * Sets up listeners for contract events and syncs existing data
 */
export async function startEventListener() {
  try {
    console.log('Starting blockchain event listener...');

    // Load contract ABI
    const contractArtifactPath = path.join(__dirname, '../../artifacts/contracts/StravaChallenge.sol/StravaChallenge.json');
    const contractArtifact = JSON.parse(fs.readFileSync(contractArtifactPath, 'utf8'));

    // Connect to blockchain
    provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS,
      contractArtifact.abi,
      provider
    );

    console.log(`Connected to contract at ${process.env.CONTRACT_ADDRESS}`);

    // Sync existing data on startup
    await syncExistingData();

    // Listen for new events
    setupEventListeners();

    console.log('Event listener started successfully');

  } catch (error) {
    console.error('Failed to start event listener:', error);
    throw error;
  }
}

/**
 * Sync all existing challenges and participants from the blockchain
 */
async function syncExistingData() {
  try {
    const challengeCount = await contract.getChallengeCount();
    console.log(`Syncing ${challengeCount} existing challenges...`);

    for (let i = 0; i < challengeCount; i++) {
      await syncChallenge(i);
    }

    console.log('Initial sync complete');
  } catch (error) {
    console.error('Error during initial sync:', error);
  }
}

/**
 * Sync a single challenge and its participants from the blockchain
 */
async function syncChallenge(challengeId) {
  try {
    const challengeData = await contract.challenges(challengeId);

    // Insert or update challenge
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
        challengeId,
        challengeData.creator.toLowerCase(),
        Number(challengeData.startTime),
        Number(challengeData.endTime),
        challengeData.stakeAmount.toString(),
        challengeData.totalStaked.toString(),
        'PENDING',
        challengeData.winner.toLowerCase(),
        Number(challengeData.participantCount)
      ]
    );

    // Sync participants
    const participantAddresses = await contract.getParticipants(challengeId);

    for (const address of participantAddresses) {
      const participantData = await contract.getParticipant(challengeId, address);

      await query(
        `INSERT INTO participants
         (challenge_id, wallet_address, strava_user_id, has_joined, stake_paid)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (challenge_id, wallet_address) DO UPDATE SET
           strava_user_id = EXCLUDED.strava_user_id,
           has_joined = EXCLUDED.has_joined,
           stake_paid = EXCLUDED.stake_paid`,
        [
          challengeId,
          address.toLowerCase(),
          participantData.stravaUserId,
          participantData.hasJoined,
          participantData.hasJoined
        ]
      );
    }

    console.log(`Synced challenge ${challengeId} with ${participantAddresses.length} participants`);
  } catch (error) {
    console.error(`Error syncing challenge ${challengeId}:`, error);
  }
}

/**
 * Set up event listeners for contract events
 */
function setupEventListeners() {
  // Listen for ChallengeCreated events
  contract.on('ChallengeCreated', async (challengeId, creator, startTime, endTime, stakeAmount, event) => {
    console.log(`Event: ChallengeCreated #${challengeId}`);
    try {
      await syncChallenge(Number(challengeId));
    } catch (error) {
      console.error(`Error handling ChallengeCreated event:`, error);
    }
  });

  // Listen for ParticipantJoined events
  contract.on('ParticipantJoined', async (challengeId, participant, stravaUserId, event) => {
    console.log(`Event: ParticipantJoined - Challenge #${challengeId}, Participant: ${participant}`);
    try {
      // Re-sync the entire challenge to update participant count and total staked
      await syncChallenge(Number(challengeId));
    } catch (error) {
      console.error(`Error handling ParticipantJoined event:`, error);
    }
  });

  // Listen for ChallengeFinalized events
  contract.on('ChallengeFinalized', async (challengeId, winner, event) => {
    console.log(`Event: ChallengeFinalized - Challenge #${challengeId}, Winner: ${winner}`);
    try {
      await syncChallenge(Number(challengeId));
    } catch (error) {
      console.error(`Error handling ChallengeFinalized event:`, error);
    }
  });

  console.log('Event listeners registered for: ChallengeCreated, ParticipantJoined, ChallengeFinalized');
}

/**
 * Stop the event listener (for graceful shutdown)
 */
export async function stopEventListener() {
  if (contract) {
    contract.removeAllListeners();
    console.log('Event listeners stopped');
  }
  if (provider) {
    provider.destroy();
  }
}
