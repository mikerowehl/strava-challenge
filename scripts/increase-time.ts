import { network } from "hardhat";

// Get seconds from environment variable
const seconds = parseInt(process.env.SECONDS || "0");

if (!seconds || seconds <= 0) {
  console.error("Usage: SECONDS=86400 npx hardhat run scripts/increase-time.ts --network localhost");
  console.error("\nExamples:");
  console.error("  SECONDS=86400 npx hardhat run scripts/increase-time.ts --network localhost   # 1 day");
  console.error("  SECONDS=604800 npx hardhat run scripts/increase-time.ts --network localhost  # 7 days");
  process.exit(1);
}

const { ethers } = await network.connect();

await ethers.provider.send("evm_increaseTime", [seconds]);
await ethers.provider.send("evm_mine", []);

const block = await ethers.provider.getBlock("latest");
const timestamp = block!.timestamp;
const date = new Date(timestamp * 1000);

console.log(`✓ Increased time by ${seconds} seconds (${(seconds / 86400).toFixed(2)} days)`);
console.log(`New blockchain timestamp: ${timestamp}`);
console.log(`New blockchain time: ${date.toISOString()}`);
