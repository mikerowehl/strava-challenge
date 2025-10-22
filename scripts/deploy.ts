import { network } from "hardhat";

const { ethers } = await network.connect();

// Get signers
const [deployer, oracleAccount] = await ethers.getSigners();

console.log("Deploying contracts with account:", deployer.address);
const balance = await ethers.provider.getBalance(deployer.address);
console.log("Account balance:", ethers.formatEther(balance), "ETH");

// Determine oracle address
// For local networks, use account #1 as oracle
// For other networks, use environment variable or deployer
let oracleAddress: string;
const networkName = network.name;

if (networkName === "localhost" || networkName === "hardhat") {
  // Local: use second account as oracle
  oracleAddress = oracleAccount.address;
  console.log("Using local account #1 as oracle:", oracleAddress);
} else {
  // Testnet/mainnet: read from environment or use deployer
  oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  console.log("Using oracle address:", oracleAddress);
}

// Deploy contract
console.log("\nDeploying StravaChallenge contract...");
const contract = await ethers.deployContract("StravaChallenge", [oracleAddress]);
await contract.waitForDeployment();
const contractAddress = await contract.getAddress();

console.log("\n=================================");
console.log("✅ Contract deployed successfully!");
console.log("=================================");
console.log("Contract address:", contractAddress);
console.log("Oracle address:", oracleAddress);
console.log("Network:", networkName);
console.log("=================================\n");

// Print configuration instructions
console.log("📝 Configuration:");
console.log("\n1. Frontend (.env):");
console.log("   REACT_APP_CONTRACT_ADDRESS=" + contractAddress);

console.log("\n2. Oracle (.env):");
console.log("   CONTRACT_ADDRESS=" + contractAddress);

if (networkName === "localhost" || networkName === "hardhat") {
  console.log("   ORACLE_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  console.log("   RPC_URL=http://localhost:8545");
  console.log("   CHAIN_ID=31337");
}

console.log("\n=================================\n");

// Verify contract setup
const challengeCount = await contract.getChallengeCount();
const storedOracle = await contract.oracle();

console.log("Contract verification:");
console.log("  Challenge count:", challengeCount.toString());
console.log("  Oracle address:", storedOracle);
console.log("  Match:", storedOracle === oracleAddress ? "✅" : "❌");

console.log("\n✅ Deployment complete!\n");
