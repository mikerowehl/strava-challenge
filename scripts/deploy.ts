import { network } from "hardhat";

const { ethers } = await network.connect();

// Get signers
const [deployer, oracleAccount] = await ethers.getSigners();

console.log("Deploying contracts with account:", deployer.address);
const balance = await ethers.provider.getBalance(deployer.address);
console.log("Account balance:", ethers.formatEther(balance), "ETH");

// Determine oracle address
// For local development, use account #1 as oracle
// For other networks, require ORACLE_ADDRESS environment variable
let oracleAddress: string;

// Detect if we're on a local development network by checking chain ID
const chainId = (await ethers.provider.getNetwork()).chainId;
const isLocalNetwork = chainId === 31337n || chainId === 1337n;

console.log("Detected network chain ID:", chainId.toString());
console.log("Network mode:", isLocalNetwork ? "LOCAL (Hardhat/Localhost)" : "REMOTE (Testnet/Mainnet)");

if (isLocalNetwork) {
  // Local development: use second account as oracle
  oracleAddress = oracleAccount.address;
  console.log("Using local account #1 as oracle:", oracleAddress);
} else {
  // Remote network: require ORACLE_ADDRESS environment variable
  if (!process.env.ORACLE_ADDRESS) {
    throw new Error(
      "ORACLE_ADDRESS environment variable is required for non-local deployments.\n" +
      "Please set ORACLE_ADDRESS in your .env file or environment."
    );
  }
  oracleAddress = process.env.ORACLE_ADDRESS;
  console.log("Using oracle address from environment:", oracleAddress);
}

// Deploy contract
console.log("\nDeploying StravaChallenge contract...");
const contract = await ethers.deployContract("StravaChallenge", [oracleAddress]);
await contract.waitForDeployment();
const contractAddress = await contract.getAddress();

console.log("\n=================================");
console.log("Contract deployed successfully!");
console.log("=================================");
console.log("Contract address:", contractAddress);
console.log("Oracle address:", oracleAddress);
console.log("Chain ID:", chainId.toString());
console.log("=================================\n");

// Print configuration instructions
console.log("Configuration:");
console.log("\n1. Frontend (.env):");
console.log("   REACT_APP_CONTRACT_ADDRESS=" + contractAddress);

console.log("\n2. Oracle (.env):");
console.log("   CONTRACT_ADDRESS=" + contractAddress);

if (isLocalNetwork) {
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
console.log("  Match:", storedOracle === oracleAddress ? "PASS" : "FAIL");

console.log("\nDeployment complete!\n");
