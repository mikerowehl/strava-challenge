/**
 * Utility functions for parsing and handling blockchain errors from ethers.js
 */

/**
 * Parse an ethers.js error and extract a user-friendly message
 * @param {Error} error - The error object from ethers.js
 * @param {string} context - Context of where the error occurred (e.g., "loading challenge")
 * @returns {string} A user-friendly error message
 */
export function parseBlockchainError(error, context = 'operation') {
  console.error(`Blockchain error during ${context}:`, error);

  // Handle CALL_EXCEPTION errors specifically
  if (error.code === 'CALL_EXCEPTION') {
    // Try to extract revert reason from various places in the error object
    const reason = error.reason || error.revert?.args?.[0] || error.data?.message;

    if (reason) {
      return reason;
    }

    // Check if this is a "missing revert data" error - likely means contract call failed
    if (error.message?.includes('missing revert data')) {
      // Check the transaction data to guess the function being called
      const txData = error.transaction?.data;

      if (txData) {
        // Function selector for challenges(uint256) is first 4 bytes: 0x8f1d3776
        // Function selector for getEffectiveState(uint256): 0x8c8b5c8e
        // Function selector for getParticipants(uint256): 0x5aa68ac0

        if (txData.startsWith('0x8f1d3776') ||
            txData.startsWith('0x8c8b5c8e') ||
            txData.startsWith('0x5aa68ac0')) {
          return 'Challenge does not exist';
        }
      }

      return `Transaction failed: the contract call reverted without providing an error message`;
    }

    // Generic CALL_EXCEPTION
    return `Contract call failed during ${context}`;
  }

  // Handle user rejection
  if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
    return 'Transaction was rejected';
  }

  // Handle network errors
  if (error.code === 'NETWORK_ERROR') {
    return 'Network error - please check your connection';
  }

  // Handle insufficient funds
  if (error.code === 'INSUFFICIENT_FUNDS') {
    return 'Insufficient funds to complete transaction';
  }

  // Handle timeout
  if (error.code === 'TIMEOUT') {
    return 'Transaction timed out - please try again';
  }

  // Handle nonce errors
  if (error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED') {
    return 'Transaction nonce error - please try again';
  }

  // Try to extract meaningful message from various error formats
  if (error.message) {
    // Remove technical details that aren't useful to users
    let message = error.message;

    // Extract just the first line if it's a multi-line error
    const firstLine = message.split('\n')[0];

    // If the first line contains useful info, use it
    if (firstLine.length < 200 && !firstLine.includes('transaction=')) {
      return firstLine;
    }

    // Try to find a reason in parentheses
    const reasonMatch = message.match(/reason="([^"]+)"/);
    if (reasonMatch) {
      return reasonMatch[1];
    }
  }

  // Fallback to generic message
  return `Failed to complete ${context}`;
}

/**
 * Check if an error is related to a non-existent challenge
 * @param {Error} error - The error object
 * @returns {boolean} True if the error indicates the challenge doesn't exist
 */
export function isNonExistentChallengeError(error) {
  if (!error) return false;

  const message = error.message?.toLowerCase() || '';
  const reason = error.reason?.toLowerCase() || '';

  return (
    message.includes('challenge does not exist') ||
    reason.includes('challenge does not exist') ||
    (error.code === 'CALL_EXCEPTION' && message.includes('missing revert data'))
  );
}

/**
 * Create a user-friendly error message for specific operations
 * @param {string} operation - The operation being performed
 * @param {Error} error - The error object
 * @returns {string} A user-friendly error message
 */
export function getOperationError(operation, error) {
  const parsedError = parseBlockchainError(error, operation);

  // Add context-specific suggestions
  const suggestions = {
    'loading challenge': 'Please verify the challenge ID is correct.',
    'joining challenge': 'Please check that you are on the whitelist and have enough funds.',
    'claiming prize': 'Please ensure you are the winner and all conditions are met.',
    'withdrawing': 'Please ensure you have a stake to withdraw.',
  };

  const suggestion = suggestions[operation];
  return suggestion ? `${parsedError} ${suggestion}` : parsedError;
}
