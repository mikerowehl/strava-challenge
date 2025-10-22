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
        uint256 id;
        address creator;
        uint256 startTime;
        uint256 endTime;
        uint256 stakeAmount;
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

    // Array of all challenges
    Challenge[] public challenges;

    // challengeId => userAddress => Participant
    mapping(uint256 => mapping(address => Participant)) public participants;

    // challengeId => array of allowed addresses
    mapping(uint256 => address[]) public allowedParticipantsList;

    // Oracle address that can submit results
    address public oracle;

    // Grace period after challenge ends (7 days)
    uint256 public constant GRACE_PERIOD = 7 days;
    
    // Emergency withdrawal period (14 days after end)
    uint256 public constant EMERGENCY_PERIOD = 14 days;

    event ChallengeCreated(
        uint256 indexed challengeId,
        address indexed creator,
        uint256 startTime,
        uint256 endTime,
        uint256 stakeAmount,
        uint256 allowedParticipantsCount
    );

    event ParticipantJoined(
        uint256 indexed challengeId,
        address indexed participant,
        string stravaUserId
    );

    event ChallengeFinalized(
        uint256 indexed challengeId,
        address indexed winner,
        bytes32 dataHash,
        uint256 prizeAmount
    );

    event ChallengeCancelled(uint256 indexed challengeId);

    event PrizeClaimed(
        uint256 indexed challengeId,
        address indexed winner,
        uint256 amount
    );

    event EmergencyWithdrawal(
        uint256 indexed challengeId,
        address indexed participant,
        uint256 amount
    );

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle can call");
        _;
    }

    modifier onlyCreator(uint256 challengeId) {
        require(challengeId < challenges.length, "Challenge does not exist");
        require(msg.sender == challenges[challengeId].creator, "Only creator can call");
        _;
    }

    constructor(address _oracle) {
        oracle = _oracle;
    }

    /**
     * @notice Create a new challenge with a whitelist of allowed participants
     * @dev The challenge creator is automatically added to the whitelist
     * @param startTime Unix timestamp when challenge starts
     * @param endTime Unix timestamp when challenge ends
     * @param stakeAmount Amount each participant must stake (in wei)
     * @param allowedAddresses Array of OTHER addresses allowed to join (creator auto-included)
     * @return challengeId The ID of the newly created challenge
     */
    function createChallenge(
        uint256 startTime,
        uint256 endTime,
        uint256 stakeAmount,
        address[] calldata allowedAddresses
    ) external returns (uint256 challengeId) {
        require(startTime > block.timestamp, "Start time must be in future");
        require(endTime > startTime, "End time must be after start");
        require(stakeAmount > 0, "Stake must be positive");
        require(allowedAddresses.length >= 1, "Need at least 1 other participant");

        challengeId = challenges.length;

        challenges.push(Challenge({
            id: challengeId,
            creator: msg.sender,
            startTime: startTime,
            endTime: endTime,
            stakeAmount: stakeAmount,
            totalStaked: 0,
            state: ChallengeState.PENDING,
            winner: address(0),
            finalDataHash: bytes32(0),
            participantCount: 0
        }));

        // Automatically add creator to whitelist
        allowedParticipantsList[challengeId].push(msg.sender);

        // Store allowed participants and check for duplicates
        for (uint256 i = 0; i < allowedAddresses.length; i++) {
            require(allowedAddresses[i] != address(0), "Invalid address in whitelist");
            require(allowedAddresses[i] != msg.sender, "Creator is automatically included");

            // Check for duplicates by searching array (including creator)
            for (uint256 j = 0; j < allowedParticipantsList[challengeId].length; j++) {
                require(allowedParticipantsList[challengeId][j] != allowedAddresses[i], "Duplicate address in whitelist");
            }

            allowedParticipantsList[challengeId].push(allowedAddresses[i]);
        }

        emit ChallengeCreated(
            challengeId,
            msg.sender,
            startTime,
            endTime,
            stakeAmount,
            allowedParticipantsList[challengeId].length
        );
    }

    /**
     * @notice Check if an address is allowed to join a challenge
     * @param challengeId The challenge ID
     * @param addr The address to check
     * @return bool True if address is in the whitelist
     */
    function isAllowedParticipant(uint256 challengeId, address addr) public view returns (bool) {
        require(challengeId < challenges.length, "Challenge does not exist");
        address[] memory allowed = allowedParticipantsList[challengeId];
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == addr) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Get the effective state of a challenge (computed lazily)
     * @dev Computes state based on timestamps and participant count without requiring explicit transitions
     * @param challengeId The challenge ID
     * @return ChallengeState The effective current state
     */
    function getEffectiveState(uint256 challengeId) public view returns (ChallengeState) {
        require(challengeId < challenges.length, "Challenge does not exist");
        Challenge storage challenge = challenges[challengeId];
        ChallengeState storedState = challenge.state;

        // Terminal states are always returned as-is
        if (storedState == ChallengeState.COMPLETED ||
            storedState == ChallengeState.FINALIZED ||
            storedState == ChallengeState.CANCELLED) {
            return storedState;
        }

        // Get the number of required participants (whitelist length)
        uint256 requiredParticipants = allowedParticipantsList[challengeId].length;

        // Check if challenge should be cancelled (not all whitelisted participants joined after start time)
        if (storedState == ChallengeState.PENDING &&
            block.timestamp >= challenge.startTime &&
            challenge.participantCount < requiredParticipants) {
            return ChallengeState.CANCELLED;
        }

        // Check if challenge is in grace period (ended but not finalized)
        if (block.timestamp >= challenge.endTime) {
            return ChallengeState.GRACE_PERIOD;
        }

        // Check if challenge should be active (started with all participants)
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
        uint256 challengeId,
        string calldata stravaUserId
    ) external payable {
        require(challengeId < challenges.length, "Challenge does not exist");
        Challenge storage challenge = challenges[challengeId];
        require(isAllowedParticipant(challengeId, msg.sender), "Not on whitelist");
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

        challenge.totalStaked += msg.value;
        challenge.participantCount++;

        emit ParticipantJoined(challengeId, msg.sender, stravaUserId);
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
        uint256 challengeId,
        address winner,
        bytes32 dataHash,
        uint256 timestamp,
        bytes calldata oracleSignature
    ) external {
        require(challengeId < challenges.length, "Challenge does not exist");
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
     * @notice Winner claims their prize from an already-finalized challenge
     * @dev This is a fallback for challenges finalized via claimPrizeWithSignature but not yet claimed
     * @param challengeId The challenge to claim from
     */
    function claimPrize(uint256 challengeId) external {
        require(challengeId < challenges.length, "Challenge does not exist");
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
        uint256 challengeId,
        bytes[] calldata signatures
    ) external {
        require(challengeId < challenges.length, "Challenge does not exist");
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
    function withdrawFromCancelled(uint256 challengeId) external {
        require(challengeId < challenges.length, "Challenge does not exist");
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
    function emergencyWithdraw(uint256 challengeId) external {
        require(challengeId < challenges.length, "Challenge does not exist");
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
     * @notice Get list of all participants who have joined a challenge
     * @dev Iterates through allowed participants and returns those who actually joined
     * @param challengeId The challenge ID
     * @return Array of participant addresses who have joined
     */
    function getParticipants(uint256 challengeId) external view returns (address[] memory) {
        require(challengeId < challenges.length, "Challenge does not exist");

        address[] memory allowed = allowedParticipantsList[challengeId];
        uint256 joinedCount = 0;

        // First pass: count how many have joined
        for (uint256 i = 0; i < allowed.length; i++) {
            if (participants[challengeId][allowed[i]].hasJoined) {
                joinedCount++;
            }
        }

        // Second pass: build the result array
        address[] memory result = new address[](joinedCount);
        uint256 index = 0;
        for (uint256 i = 0; i < allowed.length; i++) {
            if (participants[challengeId][allowed[i]].hasJoined) {
                result[index] = allowed[i];
                index++;
            }
        }

        return result;
    }

    /**
     * @notice Get list of allowed participants for a challenge
     * @param challengeId The challenge ID
     * @return Array of allowed addresses
     */
    function getAllowedParticipants(uint256 challengeId) external view returns (address[] memory) {
        require(challengeId < challenges.length, "Challenge does not exist");
        return allowedParticipantsList[challengeId];
    }

    /**
     * @notice Get participant details
     * @param challengeId The challenge ID
     * @param participant The participant address
     * @return Participant struct
     */
    function getParticipant(
        uint256 challengeId,
        address participant
    ) external view returns (Participant memory) {
        require(challengeId < challenges.length, "Challenge does not exist");
        return participants[challengeId][participant];
    }

    /**
     * @notice Check if challenge can be finalized
     * @param challengeId The challenge ID
     * @return bool indicating if finalization is possible
     */
    function canFinalize(uint256 challengeId) external view returns (bool) {
        if (challengeId >= challenges.length) {
            return false;
        }
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

    /**
     * @notice Get total number of challenges created
     * @return Total count of challenges
     */
    function getChallengeCount() external view returns (uint256) {
        return challenges.length;
    }
}
