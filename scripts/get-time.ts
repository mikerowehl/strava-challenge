import { network } from "hardhat";

const { ethers } = await network.connect();

const block = await ethers.provider.getBlock("latest");
const timestamp = block!.timestamp;
const date = new Date(timestamp * 1000);

console.log(`Current blockchain timestamp: ${timestamp}`);
console.log(`Current blockchain time (UTC): ${date.toISOString()}`);
console.log(`Current blockchain time (local): ${date.toLocaleString()}`);
console.log(`Block number: ${block!.number}`);
