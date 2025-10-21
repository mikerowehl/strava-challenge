import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// Initialize oracle wallet from private key
let oracleWallet;

export function getOracleWallet() {
  if (!oracleWallet) {
    const privateKey = process.env.ORACLE_PRIVATE_KEY;

    if (!privateKey || privateKey === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      throw new Error('ORACLE_PRIVATE_KEY not configured. Please set a valid private key in .env');
    }

    oracleWallet = new ethers.Wallet(privateKey);
    console.log('✅ Oracle wallet initialized:', oracleWallet.address);
  }

  return oracleWallet;
}

/**
 * Sign a finalization message for a challenge
 * @param {number} challengeId - The challenge ID
 * @param {string} winnerAddress - The winner's Ethereum address
 * @param {string} dataHash - Hash of the challenge results
 * @param {number} timestamp - Unix timestamp when signature was created
 * @returns {string} The signature
 */
export async function signFinalization(challengeId, winnerAddress, dataHash, timestamp) {
  const wallet = getOracleWallet();

  // Create the message hash matching the contract's format
  // Must match: keccak256(abi.encodePacked("FINALIZE_CHALLENGE_", challengeId, winner, dataHash, timestamp))
  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'uint256', 'address', 'bytes32', 'uint256'],
    ['FINALIZE_CHALLENGE_', challengeId, winnerAddress, dataHash, timestamp]
  );

  // Sign the message hash
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  console.log('Signed finalization:', {
    challengeId,
    winner: winnerAddress,
    dataHash,
    timestamp,
    messageHash,
    signature
  });

  return signature;
}

/**
 * Get oracle wallet address
 */
export function getOracleAddress() {
  return getOracleWallet().address;
}
