import React, { useState, useEffect } from 'react';
import { useWallet } from '../context/WalletContext';
import { ethers } from 'ethers';
import { getStateLabel } from '../utils/contract';
import { getStravaStatus, getStravaAuthUrl, getFinalization, confirmMileage, setMockMileage, isMockMode as checkMockMode, getParticipants, getLeaderboard } from '../utils/api';
import Leaderboard from './Leaderboard';
import { debugBlockchainState } from '../utils/debug';

function ChallengeView({ challengeId }) {
  const { contract, account, isConnected, getReadOnlyContract } = useWallet();
  const [challenge, setChallenge] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isAllowed, setIsAllowed] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [stravaUserId, setStravaUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [txStatus, setTxStatus] = useState(null);
  const [mockMiles, setMockMiles] = useState('0');
  const [isMockMode, setIsMockMode] = useState(false);
  const [blockchainTime, setBlockchainTime] = useState(null);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [isLeader, setIsLeader] = useState(false);

  useEffect(() => {
    loadChallenge();
  }, [challengeId, account]);

  useEffect(() => {
    if (account) {
      checkStravaStatus();
    }
  }, [account]);

  useEffect(() => {
    // Check if oracle is in mock mode
    const checkMode = async () => {
      const mockMode = await checkMockMode();
      console.log('[ChallengeView] Mock mode detected:', mockMode);
      setIsMockMode(mockMode);
    };
    checkMode();
  }, []);

  const loadChallenge = async () => {
    try {
      setLoading(true);
      setError(null);

      const contractToUse = contract || getReadOnlyContract();
      if (!contractToUse) {
        setError('Contract not initialized. Please set CONTRACT_ADDRESS in .env');
        return;
      }

      // Get challenge data
      const data = await contractToUse.challenges(challengeId);
      const state = await contractToUse.getEffectiveState(challengeId);
      const participantAddresses = await contractToUse.getParticipants(challengeId);

      // Debug: Check what the provider is seeing
      const provider = contractToUse.runner?.provider || contractToUse.provider;
      await debugBlockchainState(provider, contractToUse, challengeId);

      // Get current blockchain time for UI calculations
      const currentBlock = await provider.getBlock('latest');
      setBlockchainTime(currentBlock.timestamp);

      setChallenge({
        id: data.id.toString(),
        creator: data.creator,
        startTime: Number(data.startTime),
        endTime: Number(data.endTime),
        stakeAmount: data.stakeAmount,
        totalStaked: data.totalStaked,
        state: Number(state),
        winner: data.winner,
        participantCount: Number(data.participantCount)
      });

      setParticipants(participantAddresses);

      // Check if current user is allowed and has joined
      if (account) {
        const allowed = await contractToUse.isAllowedParticipant(challengeId, account);
        setIsAllowed(allowed);

        if (allowed) {
          const participantData = await contractToUse.getParticipant(challengeId, account);
          setHasJoined(participantData.hasJoined);
          if (participantData.hasJoined) {
            setStravaUserId(participantData.stravaUserId);

            // Check confirmation status and leader status from oracle
            try {
              const participantsData = await getParticipants(challengeId);
              const currentUserData = participantsData.participants.find(
                p => p.walletAddress.toLowerCase() === account.toLowerCase()
              );
              if (currentUserData) {
                setHasConfirmed(currentUserData.confirmed);
              }

              // Check if user is the leader (rank 1 on leaderboard)
              try {
                const leaderboardData = await getLeaderboard(challengeId);
                if (leaderboardData.leaderboard && leaderboardData.leaderboard.length > 0) {
                  const leader = leaderboardData.leaderboard[0];
                  setIsLeader(leader.address.toLowerCase() === account.toLowerCase());
                }
              } catch (err) {
                console.error('Error fetching leaderboard for leader check:', err);
                // Don't throw - just log the error
              }
            } catch (err) {
              console.error('Error fetching confirmation status:', err);
              // Don't throw - just log the error
            }
          }
        }
      }

    } catch (err) {
      console.error('Error loading challenge:', err);
      setError('Failed to load challenge: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkStravaStatus = async () => {
    try {
      const status = await getStravaStatus(account);
      setStravaConnected(status.connected);
      if (status.connected) {
        setStravaUserId(status.stravaUserId);
      }
    } catch (err) {
      console.error('Error checking Strava status:', err);
      // Don't throw - just log the error and assume not connected
      setStravaConnected(false);
    }
  };

  const handleConnectStrava = () => {
    const authUrl = getStravaAuthUrl(account, challengeId);
    window.open(authUrl, '_blank', 'width=600,height=700');

    // Poll for Strava connection
    const pollInterval = setInterval(async () => {
      await checkStravaStatus();
      const status = await getStravaStatus(account);
      if (status.connected) {
        clearInterval(pollInterval);
        setStravaConnected(true);
        setStravaUserId(status.stravaUserId);
      }
    }, 2000);

    // Stop polling after 2 minutes
    setTimeout(() => clearInterval(pollInterval), 120000);
  };

  const handleJoinChallenge = async () => {
    if (!contract || !stravaUserId) {
      setError('Please connect Strava first');
      return;
    }

    try {
      setTxStatus('Sending transaction...');
      setError(null);

      const tx = await contract.joinChallenge(
        challengeId,
        stravaUserId,
        { value: challenge.stakeAmount }
      );

      setTxStatus(`Transaction submitted: ${tx.hash.substring(0, 10)}...`);
      await tx.wait();
      setTxStatus('Successfully joined challenge!');

      // Reload challenge data
      setTimeout(loadChallenge, 2000);

    } catch (err) {
      console.error('Error joining challenge:', err);
      setError('Failed to join: ' + err.message);
      setTxStatus(null);
    }
  };

  const handleClaimPrize = async () => {
    try {
      setTxStatus('Fetching finalization signature...');
      setError(null);

      // Get finalization signature from oracle
      const finalizationData = await getFinalization(challengeId);

      setTxStatus('Claiming prize...');

      const tx = await contract.claimPrizeWithSignature(
        challengeId,
        finalizationData.winner.address,
        finalizationData.dataHash,
        finalizationData.timestamp,
        finalizationData.signature
      );

      setTxStatus(`Transaction submitted: ${tx.hash.substring(0, 10)}...`);
      await tx.wait();
      setTxStatus('Prize claimed successfully!');

      // Reload challenge data
      setTimeout(loadChallenge, 2000);

    } catch (err) {
      console.error('Error claiming prize:', err);
      setError('Failed to claim: ' + err.message);
      setTxStatus(null);
    }
  };

  const handleConfirmMileage = async () => {
    try {
      setTxStatus('Signing confirmation...');
      setError(null);

      const signer = await contract.runner.provider.getSigner();
      const message = `CONFIRM_CHALLENGE_${challengeId}`;
      const signature = await signer.signMessage(message);

      setTxStatus('Submitting confirmation...');
      await confirmMileage(challengeId, account, signature);

      setTxStatus('Mileage confirmed!');
      setHasConfirmed(true);
      setTimeout(() => setTxStatus(null), 3000);

    } catch (err) {
      console.error('Error confirming mileage:', err);
      setError('Failed to confirm: ' + err.message);
      setTxStatus(null);
    }
  };

  const handleSetMockMileage = async () => {
    try {
      setTxStatus('Setting mock mileage...');
      setError(null);

      const miles = parseFloat(mockMiles);
      if (isNaN(miles) || miles < 0) {
        setError('Please enter a valid number of miles');
        setTxStatus(null);
        return;
      }

      await setMockMileage(challengeId, account, miles);

      setTxStatus(`Mock mileage set to ${miles} miles!`);
      setTimeout(() => setTxStatus(null), 3000);

    } catch (err) {
      console.error('Error setting mock mileage:', err);
      setError('Failed to set mileage: ' + err.message);
      setTxStatus(null);
    }
  };

  const formatEth = (wei) => {
    return ethers.formatEther(wei);
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  };

  const formatAddress = (address) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const getTimeRemaining = () => {
    if (!challenge || !blockchainTime) return '';
    const now = blockchainTime;

    if (now < challenge.startTime) {
      const diff = challenge.startTime - now;
      const days = Math.floor(diff / 86400);
      const hours = Math.floor((diff % 86400) / 3600);
      return `Starts in ${days}d ${hours}h`;
    } else if (now < challenge.endTime) {
      const diff = challenge.endTime - now;
      const days = Math.floor(diff / 86400);
      const hours = Math.floor((diff % 86400) / 3600);
      return `Ends in ${days}d ${hours}h`;
    } else {
      return 'Ended';
    }
  };

  const canJoin = () => {
    if (!challenge || !isConnected || !isAllowed || hasJoined || !blockchainTime) return false;
    // Check if challenge is PENDING and blockchain time is before start
    // Using blockchain time instead of system time for consistency with smart contract
    return challenge.state === 0 && blockchainTime < challenge.startTime && stravaConnected;
  };

  const canClaim = () => {
    if (!challenge || !isConnected || !account) return false;
    return challenge.state === 2 && // GRACE_PERIOD
           challenge.winner === ethers.ZeroAddress &&
           hasJoined &&
           isLeader; // Only the leader can claim
  };

  const isWinner = () => {
    return challenge?.winner?.toLowerCase() === account?.toLowerCase();
  };

  if (loading) {
    return <div className="challenge-view">Loading challenge...</div>;
  }

  if (error && !challenge) {
    return (
      <div className="challenge-view">
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="challenge-view">
      {hasJoined && (
        <div className="participant-info" style={{ marginBottom: '20px' }}>
          <p className="success">
            {canClaim() || isWinner() ? 'You won this challenge!' : 'You are participating in this challenge!'}
          </p>
        </div>
      )}

      <h2>Challenge #{challenge.id}</h2>

      <div className="challenge-info">
        <div className="info-row">
          <strong>State:</strong>
          <span className={`state state-${challenge.state}`}>
            {getStateLabel(challenge.state)}
          </span>
        </div>

        <div className="info-row">
          <strong>Start:</strong>
          <span>{formatDate(challenge.startTime)}</span>
        </div>

        <div className="info-row">
          <strong>End:</strong>
          <span>{formatDate(challenge.endTime)}</span>
        </div>

        <div className="info-row">
          <strong>Status:</strong>
          <span>{getTimeRemaining()}</span>
        </div>

        <div className="info-row">
          <strong>Stake:</strong>
          <span>{formatEth(challenge.stakeAmount)} ETH</span>
        </div>

        <div className="info-row">
          <strong>Prize Pool:</strong>
          <span>{formatEth(challenge.totalStaked)} ETH</span>
        </div>

        <div className="info-row">
          <strong>Participants:</strong>
          <span>{challenge.participantCount}</span>
        </div>

        {challenge.winner !== ethers.ZeroAddress && (
          <div className="info-row">
            <strong>Winner:</strong>
            <span className="winner">{formatAddress(challenge.winner)}</span>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {txStatus && <div className="success">{txStatus}</div>}

      {/* Leaderboard for active/ended challenges */}
      {(challenge.state === 1 || challenge.state === 2) && (
        <Leaderboard challengeId={challengeId} currentAccount={account} />
      )}

      {/* Confirm mileage during grace period */}
      {challenge.state === 2 && hasJoined && !hasConfirmed && (
        <div className="actions">
          <h3>Confirm</h3>
          <p>Use this button to confirm that all your activities for the challenge are uploaded to Strava and the total on the Leaderboard above is correct.</p>
          <button onClick={handleConfirmMileage} className="btn btn-secondary">
            Confirm My Mileage
          </button>
        </div>
      )}

      {/* Action buttons based on state */}
      {isConnected && isAllowed && !hasJoined && challenge.state === 0 && (
        <div className="actions">
          <h3>Join Challenge</h3>

          {!stravaConnected ? (
            <div>
              <p>You need to connect your Strava account to join this challenge.</p>
              <button onClick={handleConnectStrava} className="btn btn-primary">
                Connect Strava
              </button>
            </div>
          ) : (
            <div>
              <p className="success">Strava connected! User ID: {stravaUserId}</p>
              <p>Stake required: {formatEth(challenge.stakeAmount)} ETH</p>
              <button
                onClick={handleJoinChallenge}
                className="btn btn-primary"
                disabled={!canJoin()}
              >
                Join Challenge
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mock mileage control for testing */}
      {console.log('[ChallengeView] Render check - isMockMode:', isMockMode, 'hasJoined:', hasJoined)}
      {isMockMode && hasJoined && (
        <>
          <div className="mock-banner" style={{
            background: '#fff3cd',
            border: '2px solid #ffc107',
            padding: '10px',
            marginBottom: '20px',
            borderRadius: '5px',
            textAlign: 'center'
          }}>
            <strong>MOCK MODE:</strong> Using test data instead of real Strava API
          </div>
          <div style={{ marginBottom: '15px' }}>
            <p>Your Strava ID: {stravaUserId}</p>
          </div>
          <div className="actions">
            <h3>Set Mock Mileage (Testing)</h3>
            <p>Enter mileage to simulate your running activities:</p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="number"
              step="0.1"
              min="0"
              value={mockMiles}
              onChange={(e) => setMockMiles(e.target.value)}
              placeholder="Miles"
              style={{ width: '120px' }}
            />
            <button onClick={handleSetMockMileage} className="btn btn-secondary">
              Set Mileage
            </button>
          </div>
          </div>
        </>
      )}

      {/* Claim prize */}
      {canClaim() && (
        <div className="actions">
          <h3>Claim Prize</h3>
          <p>Challenge has ended. Click to finalize and claim your prize!</p>
          <button onClick={handleClaimPrize} className="btn btn-primary">
            Claim Prize
          </button>
        </div>
      )}

      {challenge.state === 5 && isWinner() && (
        <div className="success">
          <h3>Congratulations!</h3>
          <p>You won this challenge and claimed the prize!</p>
        </div>
      )}

      {/* Participant list */}
      {participants.length > 0 && (
        <div className="participants-list">
          <h3>Participants ({participants.length})</h3>
          <ul>
            {participants.map(addr => (
              <li key={addr}>
                {formatAddress(addr)}
                {addr.toLowerCase() === account?.toLowerCase() && ' (You)'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default ChallengeView;
