import { network } from "hardhat";

const { ethers } = await network.connect();

const challengeId = parseInt(process.env.CHALLENGE_ID || "1");
const contractAddress = process.env.CONTRACT_ADDRESS;
const txHash = process.env.TX_HASH;

if (!contractAddress) {
  console.error("Please set CONTRACT_ADDRESS environment variable");
  process.exit(1);
}

// Get contract ABI
const StravaChallenge = await ethers.getContractFactory("StravaChallenge");
const contract = StravaChallenge.attach(contractAddress);

console.log('\n=== CHALLENGE STATE ===');

// Get challenge data
const challenge = await contract.challenges(challengeId);
const effectiveState = await contract.getEffectiveState(challengeId);

console.log(`Challenge ID: ${challengeId}`);
console.log(`State: ${effectiveState} (0=PENDING, 1=ACTIVE, 2=GRACE_PERIOD, 3=FINALIZED, 4=CANCELLED)`);
console.log(`Total Staked: ${ethers.formatEther(challenge.totalStaked)} ETH`);
console.log(`Winner: ${challenge.winner}`);
console.log(`Finalized: ${effectiveState === 3n ? 'Yes' : 'No'}`);

// If a transaction hash is provided, check it
if (txHash) {
  console.log('\n=== TRANSACTION DETAILS ===');

  const tx = await ethers.provider.getTransaction(txHash);
  const receipt = await ethers.provider.getTransactionReceipt(txHash);

  if (!tx || !receipt) {
    console.log(`Transaction ${txHash} not found`);
  } else {
    console.log(`Transaction Hash: ${txHash}`);
    console.log(`From: ${tx.from}`);
    console.log(`To: ${tx.to}`);
    console.log(`Status: ${receipt.status === 1 ? '✓ Success' : '✗ Failed'}`);
    console.log(`Gas Used: ${receipt.gasUsed.toString()}`);

    // Check for balance changes
    console.log('\n=== EVENTS ===');

    // Parse logs for ChallengeFinalized event
    const parsedLogs = receipt.logs
      .map(log => {
        try {
          return contract.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
        } catch {
          return null;
        }
      })
      .filter(log => log !== null);

    if (parsedLogs.length === 0) {
      console.log('No events found (transaction may have failed or been to wrong contract)');
    } else {
      parsedLogs.forEach(log => {
        console.log(`\nEvent: ${log!.name}`);
        console.log(`Arguments:`, log!.args);

        if (log!.name === 'ChallengeFinalized') {
          console.log(`  Challenge ID: ${log!.args[0]}`);
          console.log(`  Winner: ${log!.args[1]}`);
          console.log(`  Prize: ${ethers.formatEther(log!.args[2])} ETH`);
        }
      });
    }

    // Calculate balance change
    console.log('\n=== BALANCE CHANGE ===');

    // Get the block before and after the transaction
    const txBlock = receipt.blockNumber;
    const beforeBalance = await ethers.provider.getBalance(tx.from, txBlock - 1);
    const afterBalance = await ethers.provider.getBalance(tx.from, txBlock);

    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const netChange = afterBalance - beforeBalance;
    const prizeReceived = netChange + gasCost;

    console.log(`Balance before: ${ethers.formatEther(beforeBalance)} ETH`);
    console.log(`Balance after: ${ethers.formatEther(afterBalance)} ETH`);
    console.log(`Gas cost: ${ethers.formatEther(gasCost)} ETH`);
    console.log(`Net change: ${ethers.formatEther(netChange)} ETH`);
    console.log(`Prize received: ${ethers.formatEther(prizeReceived)} ETH`);

    if (prizeReceived > 0n) {
      console.log(`\n✓ Successfully claimed ${ethers.formatEther(prizeReceived)} ETH!`);
    }
  }
} else {
  console.log('\nTo verify a specific transaction, run:');
  console.log(`TX_HASH=0x... CHALLENGE_ID=${challengeId} CONTRACT_ADDRESS=${contractAddress} npx hardhat run scripts/verify-claim.ts --network localhost`);
}
