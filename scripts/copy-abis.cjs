#!/usr/bin/env node

/**
 * Copy contract ABIs from Hardhat artifacts to frontend
 * This allows the frontend to import contract ABIs without path issues
 */

const fs = require('fs');
const path = require('path');

// Paths
const artifactsDir = path.join(__dirname, '../artifacts/contracts');
const frontendAbiDir = path.join(__dirname, '../frontend/src/contracts');

// Ensure frontend contracts directory exists
if (!fs.existsSync(frontendAbiDir)) {
  fs.mkdirSync(frontendAbiDir, { recursive: true });
  console.log('Created directory:', frontendAbiDir);
}

// Copy StravaChallenge contract
const contractPath = path.join(artifactsDir, 'StravaChallenge.sol/StravaChallenge.json');
const destPath = path.join(frontendAbiDir, 'StravaChallenge.json');

if (fs.existsSync(contractPath)) {
  const contractData = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

  // Only copy what we need (abi, bytecode, contract name)
  const minimal = {
    contractName: contractData.contractName,
    abi: contractData.abi,
    bytecode: contractData.bytecode,
    deployedBytecode: contractData.deployedBytecode
  };

  fs.writeFileSync(destPath, JSON.stringify(minimal, null, 2));
  console.log('✓ Copied StravaChallenge.json to frontend/src/contracts/');
} else {
  console.error('Error: StravaChallenge artifact not found.');
  console.error('Run "npx hardhat compile" first.');
  process.exit(1);
}

console.log('\n✅ ABIs copied successfully!');
