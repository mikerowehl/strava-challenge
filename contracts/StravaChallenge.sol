// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract StravaChallenge {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    enum ChallengeState {
        PENDING,      // Accepting participants
        ACTIVE,       // Challenge running
        GRACE_PERIOD, // Ended, waiting for confirmations
        FINALIZED,    // Results submitted, winner can claim
        CANCELLED,    // Cancelled, refunds available
        COMPLETED     // Winner claimed prize
    }

    struct Challenge {
        bytes32 id;
        address creator;
        uint256 startTime;
        uint256 endTime;
        uint256 stakeAmount;
        uint256 minParticipants;
        uint256 totalStaked;
        ChallengeState state;
        address winner;
        bytes32 finalDataHash;
        uint256 participantCount;
    }

    struct Participant {
        address userAddress;
        string stravaUserId;
        uint256 stake;
        bool hasJoined;
    }

    // challengeId => Challenge
    mapping(bytes32 => Challenge) public challenges;
    
    // challengeId => userAddress => Participant
    mapping(bytes32 => mapping(address => Participant)) public participants;
    
    // challengeId => array of participant addresses
    mapping(bytes32 => address[]) public participantList;

    // Oracle address that can submit results
    address public oracle;

    // Grace period after challenge ends (7 days)
    uint256 public constant GRACE_PERIOD = 7 days;
    
    // Emergency withdrawal period (14 days after end)
    uint256 public constant EMERGENCY_PERIOD = 14 days;

    event ChallengeCreated(
        bytes32 indexed challengeId,
        address indexed creator,
        uint256 startTime,
        uint256 endTime,
        uint256 stakeAmount,
        uint256 minParticipants
    );
    
    event ParticipantJoined(
        bytes32 indexed challengeId,
        address indexed participant,
        string stravaUserId
    );
    
    event ChallengeFinalized(
        bytes32 indexed challengeId,
        address indexed winner,
        bytes32 dataHash,
        uint256 prizeAmount
    );
    
    event ChallengeCancelled(bytes32 indexed challengeId);
    
    event PrizeClaimed(
        bytes32 indexed challengeId,
        address indexed winner,
        uint256 amount
    );
    
    event EmergencyWithdrawal(
        bytes32 indexed challengeId,
        address indexed participant,
        uint256 amount
    );

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle can call");
        _;
    }

    modifier onlyCreator(bytes32 challengeId) {
        require(msg.sender == challenges[challengeId].creator, "Only creator can call");
        _;
    }

    constructor(address _oracle) {
        oracle = _oracle;
    }

    /**
     * @notice Create a new challenge with hashed ID
     * @param challengeId Hashed challenge identifier (for privacy)
     * @param startTime Unix timestamp when challenge starts
     * @param endTime Unix timestamp when challenge ends
     * @param stakeAmount Amount each participant must stake (in wei)
     * @param minParticipants Minimum number of participants needed
     */
    function createChallenge(
        bytes32 challengeId,
        uint256 startTime,
        uint256 endTime,
        uint256 stakeAmount,
        uint256 minParticipants
    ) external {
        require(challenges[challengeId].creator == address(0), "Challenge already exists");
        require(startTime > block.timestamp, "Start time must be in future");
        require(endTime > startTime, "End time must be after start");
        require(stakeAmount > 0, "Stake must be positive");
        require(minParticipants >= 2, "Need at least 2 participants");

        challenges[challengeId] = Challenge({
            id: challengeId,
            creator: msg.sender,
            startTime: startTime,
            endTime: endTime,
            stakeAmount: stakeAmount,
            minParticipants: minParticipants,
            totalStaked: 0,
            state: ChallengeState.PENDING,
            winner: address(0),
            finalDataHash: bytes32(0),
            participantCount: 0
        });

        emit ChallengeCreated(
            challengeId,
            msg.sender,
            startTime,
            endTime,
            stakeAmount,
            minParticipants
        );
    }

    /**
     * @notice Get the effective state of a challenge (computed lazily)
     * @dev Computes state based on timestamps and participant count without requiring explicit transitions
     * @param challengeId The challenge ID
     * @return ChallengeState The effective current state
     */
    function getEffectiveState(bytes32 challengeId) public view returns (ChallengeState) {
        Challenge storage challenge = challenges[challengeId];
        ChallengeState storedState = challenge.state;

        // Terminal states are always returned as-is
        if (storedState == ChallengeState.COMPLETED ||
            storedState == ChallengeState.FINALIZED ||
            storedState == ChallengeState.CANCELLED) {
            return storedState;
        }

        // Check if challenge should be cancelled (insufficient participants after start time)
        if (storedState == ChallengeState.PENDING &&
            block.timestamp >= challenge.startTime &&
            challenge.participantCount < challenge.minParticipants) {
            return ChallengeState.CANCELLED;
        }

        // Check if challenge is in grace period (ended but not finalized)
        if (block.timestamp >= challenge.endTime) {
            return ChallengeState.GRACE_PERIOD;
        }

        // Check if challenge should be active (started with enough participants)
        if (block.timestamp >= challenge.startTime) {
            return ChallengeState.ACTIVE;
        }

        // Still pending
        return ChallengeState.PENDING;
    }

    /**
     * @notice Join a challenge by paying stake and registering Strava ID
     * @param challengeId The challenge to join
     * @param stravaUserId Your Strava user ID
     */
    function joinChallenge(
        bytes32 challengeId,
        string calldata stravaUserId
    ) external payable {
        Challenge storage challenge = challenges[challengeId];

        require(challenge.creator != address(0), "Challenge does not exist");
        require(getEffectiveState(challengeId) == ChallengeState.PENDING, "Challenge not accepting participants");
        require(block.timestamp < challenge.startTime, "Registration closed");
        require(msg.value == challenge.stakeAmount, "Incorrect stake amount");
        require(!participants[challengeId][msg.sender].hasJoined, "Already joined");
        require(bytes(stravaUserId).length > 0, "Invalid Strava ID");

        participants[challengeId][msg.sender] = Participant({
            userAddress: msg.sender,
            stravaUserId: stravaUserId,
            stake: msg.value,
            hasJoined: true
        });

        participantList[challengeId].push(msg.sender);
        challenge.totalStaked += msg.value;
        challenge.participantCount++;

        emit ParticipantJoined(challengeId, msg.sender, stravaUserId);
    }


    /**
     * @notice Finalize challenge with results (called by oracle)
     * @dev This is kept as a backup method if oracle wants to finalize directly
     * @param challengeId The challenge to finalize
     * @param winner Address of the winner
     * @param dataHash Hash of all participant confirmations/results
     */
    function finalizeChallenge(
        bytes32 challengeId,
        address winner,
        bytes32 dataHash
    ) external onlyOracle {
        Challenge storage challenge = challenges[challengeId];

        require(
            getEffectiveState(challengeId) == ChallengeState.GRACE_PERIOD,
            "Challenge not in grace period"
        );
        require(
            block.timestamp >= challenge.endTime,
            "Challenge not ended"
        );
        require(
            block.timestamp < challenge.endTime + EMERGENCY_PERIOD,
            "Emergency period active, cannot finalize"
        );
        require(participants[challengeId][winner].hasJoined, "Winner not a participant");
        require(dataHash != bytes32(0), "Invalid data hash");

        challenge.state = ChallengeState.FINALIZED;
        challenge.winner = winner;
        challenge.finalDataHash = dataHash;

        emit ChallengeFinalized(
            challengeId,
            winner,
            dataHash,
            challenge.totalStaked
        );
    }

    /**
     * @notice Winner claims their prize with oracle-signed results
     * @dev Combines finalization and claiming in one transaction (winner pays gas)
     * @param challengeId The challenge to claim from
     * @param winner Address of the winner (should be msg.sender)
     * @param dataHash Hash of all participant confirmations/results
     * @param timestamp When oracle signed this result
     * @param oracleSignature Oracle's signature of the finalization data
     */
    function claimPrizeWithSignature(
        bytes32 challengeId,
        address winner,
        bytes32 dataHash,
        uint256 timestamp,
        bytes calldata oracleSignature
    ) external {
        Challenge storage challenge = challenges[challengeId];

        require(
            getEffectiveState(challengeId) == ChallengeState.GRACE_PERIOD,
            "Challenge not in grace period"
        );
        require(
            block.timestamp >= challenge.endTime,
            "Challenge not ended"
        );
        require(
            block.timestamp < challenge.endTime + EMERGENCY_PERIOD,
            "Emergency period active"
        );
        require(msg.sender == winner, "Caller must be winner");
        require(participants[challengeId][winner].hasJoined, "Winner not a participant");
        require(dataHash != bytes32(0), "Invalid data hash");
        require(timestamp <= block.timestamp, "Signature from future");
        require(
            block.timestamp - timestamp < 30 days,
            "Signature too old"
        );

        // Verify oracle signature
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "FINALIZE_CHALLENGE_",
                challengeId,
                winner,
                dataHash,
                timestamp
            )
        ).toEthSignedMessageHash();

        address signer = messageHash.recover(oracleSignature);
        require(signer == oracle, "Invalid oracle signature");

        // Finalize and transfer in one transaction
        challenge.state = ChallengeState.COMPLETED;
        challenge.winner = winner;
        challenge.finalDataHash = dataHash;

        uint256 prize = challenge.totalStaked;
        challenge.totalStaked = 0;

        emit ChallengeFinalized(challengeId, winner, dataHash, prize);
        emit PrizeClaimed(challengeId, winner, prize);

        payable(winner).transfer(prize);
    }

    /**
     * @notice Winner claims their prize (for already-finalized challenges)
     * @param challengeId The challenge to claim from
     */
    function claimPrize(bytes32 challengeId) external {
        Challenge storage challenge = challenges[challengeId];
        
        require(challenge.state == ChallengeState.FINALIZED, "Challenge not finalized");
        require(msg.sender == challenge.winner, "Only winner can claim");

        uint256 prize = challenge.totalStaked;
        challenge.state = ChallengeState.COMPLETED;
        challenge.totalStaked = 0;

        payable(msg.sender).transfer(prize);

        emit PrizeClaimed(challengeId, msg.sender, prize);
    }

    /**
     * @notice Cancel challenge with unanimous participant consent
     * @param challengeId The challenge to cancel
     * @param signatures Array of signatures from ALL participants
     */
    function cancelChallengeByConsent(
        bytes32 challengeId,
        bytes[] calldata signatures
    ) external {
        Challenge storage challenge = challenges[challengeId];
        ChallengeState effectiveState = getEffectiveState(challengeId);

        require(
            effectiveState == ChallengeState.PENDING ||
            effectiveState == ChallengeState.ACTIVE ||
            effectiveState == ChallengeState.GRACE_PERIOD,
            "Challenge cannot be cancelled"
        );
        require(
            signatures.length == challenge.participantCount,
            "Need all participant signatures"
        );

        // Verify all participants signed
        bytes32 messageHash = keccak256(
            abi.encodePacked("CANCEL_CHALLENGE_", challengeId)
        ).toEthSignedMessageHash();

        address[] memory signers = new address[](signatures.length);
        
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = messageHash.recover(signatures[i]);
            require(
                participants[challengeId][signer].hasJoined,
                "Invalid signature"
            );
            
            // Check for duplicate signatures
            for (uint256 j = 0; j < i; j++) {
                require(signers[j] != signer, "Duplicate signature");
            }
            
            signers[i] = signer;
        }

        challenge.state = ChallengeState.CANCELLED;
        emit ChallengeCancelled(challengeId);
    }

    /**
     * @notice Withdraw stake from cancelled challenge
     * @dev Lazily updates stored state to CANCELLED on first withdrawal if needed
     * @param challengeId The challenge to withdraw from
     */
    function withdrawFromCancelled(bytes32 challengeId) external {
        Challenge storage challenge = challenges[challengeId];
        Participant storage participant = participants[challengeId][msg.sender];

        require(getEffectiveState(challengeId) == ChallengeState.CANCELLED, "Challenge not cancelled");
        require(participant.stake > 0, "No stake to withdraw");

        // Lazily update stored state to CANCELLED on first withdrawal
        if (challenge.state != ChallengeState.CANCELLED) {
            challenge.state = ChallengeState.CANCELLED;
            emit ChallengeCancelled(challengeId);
        }

        uint256 amount = participant.stake;
        participant.stake = 0;
        challenge.totalStaked -= amount;

        payable(msg.sender).transfer(amount);
    }

    /**
     * @notice Emergency withdrawal if oracle fails to finalize
     * @param challengeId The challenge to withdraw from
     */
    function emergencyWithdraw(bytes32 challengeId) external {
        Challenge storage challenge = challenges[challengeId];
        Participant storage participant = participants[challengeId][msg.sender];
        ChallengeState effectiveState = getEffectiveState(challengeId);

        require(
            effectiveState != ChallengeState.FINALIZED &&
            effectiveState != ChallengeState.COMPLETED &&
            effectiveState != ChallengeState.CANCELLED,
            "Challenge already resolved"
        );
        require(
            block.timestamp >= challenge.endTime + EMERGENCY_PERIOD,
            "Emergency period not reached"
        );
        require(participant.stake > 0, "No stake to withdraw");

        uint256 amount = participant.stake;
        participant.stake = 0;
        challenge.totalStaked -= amount;

        payable(msg.sender).transfer(amount);

        emit EmergencyWithdrawal(challengeId, msg.sender, amount);
    }

    /**
     * @notice Update oracle address (only current oracle can update)
     * @param newOracle New oracle address
     */
    function updateOracle(address newOracle) external onlyOracle {
        require(newOracle != address(0), "Invalid oracle address");
        oracle = newOracle;
    }

    /**
     * @notice Get list of all participants in a challenge
     * @param challengeId The challenge ID
     * @return Array of participant addresses
     */
    function getParticipants(bytes32 challengeId) external view returns (address[] memory) {
        return participantList[challengeId];
    }

    /**
     * @notice Get participant details
     * @param challengeId The challenge ID
     * @param participant The participant address
     * @return Participant struct
     */
    function getParticipant(
        bytes32 challengeId,
        address participant
    ) external view returns (Participant memory) {
        return participants[challengeId][participant];
    }

    /**
     * @notice Check if challenge can be finalized
     * @param challengeId The challenge ID
     * @return bool indicating if finalization is possible
     */
    function canFinalize(bytes32 challengeId) external view returns (bool) {
        Challenge storage challenge = challenges[challengeId];

        if (getEffectiveState(challengeId) != ChallengeState.GRACE_PERIOD) {
            return false;
        }

        if (block.timestamp < challenge.endTime) {
            return false;
        }

        if (block.timestamp >= challenge.endTime + EMERGENCY_PERIOD) {
            return false;
        }

        return true;
    }
}
