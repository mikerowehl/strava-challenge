// Import contract ABI from local contracts directory
// ABIs are copied here by the build script: npm run compile
import contractArtifact from '../contracts/StravaChallenge.json';

export const CONTRACT_ABI = contractArtifact.abi;

// Contract address - set this after deployment or use environment variable
export const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '';

// Challenge states (matches contract enum)
export const ChallengeState = {
  0: 'PENDING',
  1: 'ACTIVE',
  2: 'GRACE_PERIOD',
  3: 'FINALIZED',
  4: 'CANCELLED',
  5: 'COMPLETED',
  PENDING: 0,
  ACTIVE: 1,
  GRACE_PERIOD: 2,
  FINALIZED: 3,
  CANCELLED: 4,
  COMPLETED: 5
};

export const getStateLabel = (state) => {
  return ChallengeState[state] || 'UNKNOWN';
};
