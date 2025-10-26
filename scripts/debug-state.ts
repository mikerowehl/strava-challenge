import { network } from "hardhat";

const { ethers } = await network.connect();

const challengeId = parseInt(process.env.CHALLENGE_ID || "1");
const contractAddress = process.env.CONTRACT_ADDRESS;

if (!contractAddress) {
  console.error("Please set CONTRACT_ADDRESS environment variable");
  process.exit(1);
}

// Get contract ABI
const StravaChallenge = await ethers.getContractFactory("StravaChallenge");
const contract = StravaChallenge.attach(contractAddress);

// Get current block time
const block = await ethers.provider.getBlock("latest");
const blockTime = block!.timestamp;
const blockDate = new Date(blockTime * 1000);

console.log("\n=== BLOCKCHAIN STATE ===");
console.log(`Current blockchain timestamp: ${blockTime}`);
console.log(`Current blockchain time: ${blockDate.toISOString()}`);
console.log(`Block number: ${block!.number}`);

// Get challenge data
const challenge = await contract.challenges(challengeId);
const effectiveState = await contract.getEffectiveState(challengeId);
const participantCount = Number(challenge.participantCount);

const startTime = Number(challenge.startTime);
const endTime = Number(challenge.endTime);
const startDate = new Date(startTime * 1000);
const endDate = new Date(endTime * 1000);

console.log("\n=== CHALLENGE DATA ===");
console.log(`Challenge ID: ${challengeId}`);
console.log(`Start time: ${startTime} (${startDate.toISOString()})`);
console.log(`End time: ${endTime} (${endDate.toISOString()})`);
console.log(`Stored state: ${challenge.state}`);
console.log(`Effective state: ${effectiveState}`);
console.log(`Participant count: ${participantCount}`);

// Get allowed participants
const allowedParticipants = await contract.getAllowedParticipants(challengeId);
console.log(`Required participants (whitelist): ${allowedParticipants.length}`);

console.log("\n=== STATE LOGIC EVALUATION ===");
console.log(`block.timestamp (${blockTime}) >= challenge.startTime (${startTime}): ${blockTime >= startTime}`);
console.log(`block.timestamp (${blockTime}) >= challenge.endTime (${endTime}): ${blockTime >= endTime}`);
console.log(`participantCount (${participantCount}) < requiredParticipants (${allowedParticipants.length}): ${participantCount < allowedParticipants.length}`);

console.log("\n=== STATE DETERMINATION ===");
if (blockTime >= endTime) {
  console.log("✓ Should be GRACE_PERIOD (2)");
} else if (blockTime >= startTime && participantCount < allowedParticipants.length) {
  console.log("✓ Should be CANCELLED (4) - started but not all participants joined");
} else if (blockTime >= startTime) {
  console.log("✓ Should be ACTIVE (1)");
} else {
  console.log("✓ Should be PENDING (0)");
}

console.log(`\nActual effective state returned: ${effectiveState}`);
console.log(`State names: 0=PENDING, 1=ACTIVE, 2=GRACE_PERIOD, 3=FINALIZED, 4=CANCELLED`);
