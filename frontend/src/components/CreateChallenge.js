import React, { useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { ethers } from 'ethers';

function CreateChallenge() {
  const { contract, isConnected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [challengeId, setChallengeId] = useState(null);
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
    startTime: '',
    endTime: '',
    stakeAmount: '',
    participants: ''
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setTxHash(null);
    setChallengeId(null);

    if (!isConnected || !contract) {
      setError('Please connect your wallet first');
      return;
    }

    try {
      setLoading(true);

      // Parse form data
      const startTimestamp = Math.floor(new Date(formData.startTime).getTime() / 1000);
      const endTimestamp = Math.floor(new Date(formData.endTime).getTime() / 1000);
      const stakeWei = ethers.parseEther(formData.stakeAmount);

      // Parse participant addresses (one per line)
      const participantAddresses = formData.participants
        .split('\n')
        .map(addr => addr.trim())
        .filter(addr => addr.length > 0);

      // Validate
      if (participantAddresses.length < 1) {
        throw new Error('Need at least 1 other participant address (you are auto-included)');
      }

      for (const addr of participantAddresses) {
        if (!ethers.isAddress(addr)) {
          throw new Error(`Invalid address: ${addr}`);
        }
      }

      // Create challenge
      const tx = await contract.createChallenge(
        startTimestamp,
        endTimestamp,
        stakeWei,
        participantAddresses
      );

      setTxHash(tx.hash);

      // Wait for transaction
      const receipt = await tx.wait();

      // Get challenge ID from event
      const event = receipt.logs.find(log => {
        try {
          const parsed = contract.interface.parseLog(log);
          return parsed.name === 'ChallengeCreated';
        } catch {
          return false;
        }
      });

      if (event) {
        const parsed = contract.interface.parseLog(event);
        setChallengeId(parsed.args.challengeId.toString());
      }

      // Reset form
      setFormData({
        startTime: '',
        endTime: '',
        stakeAmount: '',
        participants: ''
      });

    } catch (err) {
      console.error('Error creating challenge:', err);
      setError(err.message || 'Failed to create challenge');
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="create-challenge">
        <h2>Create Challenge</h2>
        <p>Please connect your wallet to create a challenge.</p>
      </div>
    );
  }

  return (
    <div className="create-challenge">
      <h2>Create Challenge</h2>

      {error && <div className="error">{error}</div>}

      {txHash && (
        <div className="success">
          <p>Transaction submitted: {txHash.substring(0, 10)}...</p>
          {challengeId && (
            <p>
              <strong>Challenge created! ID: {challengeId}</strong>
              <br />
              <a href={`#/challenge/${challengeId}`}>View Challenge</a>
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Start Time</label>
          <input
            type="datetime-local"
            name="startTime"
            value={formData.startTime}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label>End Time</label>
          <input
            type="datetime-local"
            name="endTime"
            value={formData.endTime}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label>Stake Amount (ETH)</label>
          <input
            type="number"
            step="0.001"
            name="stakeAmount"
            value={formData.stakeAmount}
            onChange={handleChange}
            placeholder="0.01"
            required
          />
        </div>

        <div className="form-group">
          <label>Other Participants (one address per line)</label>
          <textarea
            name="participants"
            value={formData.participants}
            onChange={handleChange}
            rows="6"
            placeholder="0x123...&#10;0xabc..."
            required
          />
          <small>Enter OTHER participant addresses, one per line (minimum 1). You are automatically included.</small>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
        >
          {loading ? 'Creating...' : 'Create Challenge'}
        </button>
      </form>
    </div>
  );
}

export default CreateChallenge;
