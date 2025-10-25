import { network } from "hardhat";

const { ethers } = await network.connect();

// Get signers - account #0 is deployer, account #1 is oracle
const [deployer, oracleAccount] = await ethers.getSigners();
const oracleAddress = oracleAccount.address;

const chainId = (await ethers.provider.getNetwork()).chainId;

console.log("Deploying contracts with account:", deployer.address);
console.log("Oracle address:", oracleAddress);
console.log("Chain ID:", chainId.toString());

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

// Verify contract setup
const challengeCount = await contract.getChallengeCount();
const storedOracle = await contract.oracle();

console.log("Contract verification:");
console.log("  Challenge count:", challengeCount.toString());
console.log("  Oracle address:", storedOracle);
console.log("  Match:", storedOracle === oracleAddress ? "PASS" : "FAIL");

console.log("\nDeployment complete!\n");
