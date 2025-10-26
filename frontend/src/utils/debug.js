import { ethers } from 'ethers';

// Debug utility to check blockchain state from browser
export async function debugBlockchainState(provider, contract, challengeId) {
  try {
    console.log('\n=== FRONTEND BLOCKCHAIN STATE ===');

    // Get current block
    const block = await provider.getBlock('latest');
    const blockTime = block.timestamp;
    const blockDate = new Date(blockTime * 1000);

    console.log(`Block number: ${block.number}`);
    console.log(`Block timestamp: ${blockTime}`);
    console.log(`Block time: ${blockDate.toISOString()}`);
    console.log(`Browser time: ${new Date().toISOString()}`);

    // Get challenge data
    const challenge = await contract.challenges(challengeId);
    const effectiveState = await contract.getEffectiveState(challengeId);

    const startTime = Number(challenge.startTime);
    const endTime = Number(challenge.endTime);

    console.log('\n=== CHALLENGE DATA ===');
    console.log(`Start time: ${startTime} (${new Date(startTime * 1000).toISOString()})`);
    console.log(`End time: ${endTime} (${new Date(endTime * 1000).toISOString()})`);
    console.log(`Stored state: ${challenge.state}`);
    console.log(`Effective state from contract: ${effectiveState}`);
    console.log(`Participant count: ${Number(challenge.participantCount)}`);

    console.log('\n=== STATE EVALUATION ===');
    console.log(`blockTime >= startTime: ${blockTime >= startTime}`);
    console.log(`blockTime >= endTime: ${blockTime >= endTime}`);

    return {
      blockTime,
      startTime,
      endTime,
      storedState: Number(challenge.state),
      effectiveState: Number(effectiveState)
    };
  } catch (err) {
    console.error('Debug error:', err);
    return null;
  }
}
