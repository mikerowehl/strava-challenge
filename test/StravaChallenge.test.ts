import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();
type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[0];

describe("StravaChallenge", function() {
  let stravaChallenge: any;
  let oracle: Signer;
  let creator: Signer;
  let participant1: Signer;
  let participant2: Signer;
  let participant3: Signer;

  // Common challenge parameters
  let challengeId: string;
  let startTime: number;
  let endTime: number;
  const stakeAmount = ethers.parseEther("0.1");
  const minParticipants = 2;

  beforeEach(async function() {
    // Get signers
    [oracle, creator, participant1, participant2, participant3] = await ethers.getSigners();

    // Deploy contract
    stravaChallenge = await ethers.deployContract("StravaChallenge", [oracle.address]);

    // Set up challenge parameters (start in 1 hour, end in 1 week)
    const currentBlock = await ethers.provider.getBlock('latest');
    const now = currentBlock!.timestamp;
    startTime = now + 3600; // 1 hour from now
    endTime = startTime + 7 * 24 * 3600; // 1 week after start

    // Generate unique challenge ID
    challengeId = ethers.keccak256(ethers.toUtf8Bytes("test-challenge-1"));
  });

  describe("Deployment", function() {
    it("Should set the correct oracle address", async function() {
      expect(await stravaChallenge.oracle()).to.equal(oracle.address);
    });
  });

  describe("Challenge Creation", function() {
    it("Should create a challenge with valid parameters", async function() {
      await expect(
        stravaChallenge.connect(creator).createChallenge(
          challengeId,
          startTime,
          endTime,
          stakeAmount,
          minParticipants
        )
      ).to.emit(stravaChallenge, "ChallengeCreated")
        .withArgs(challengeId, creator.address, startTime, endTime, stakeAmount, minParticipants);

      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.id).to.equal(challengeId);
      expect(challenge.creator).to.equal(creator.address);
      expect(challenge.startTime).to.equal(startTime);
      expect(challenge.endTime).to.equal(endTime);
      expect(challenge.stakeAmount).to.equal(stakeAmount);
      expect(challenge.minParticipants).to.equal(minParticipants);
      expect(challenge.totalStaked).to.equal(0);
      expect(challenge.state).to.equal(0); // PENDING
      expect(challenge.participantCount).to.equal(0);
    });

    it("Should revert if challenge ID already exists", async function() {
      await stravaChallenge.connect(creator).createChallenge(
        challengeId,
        startTime,
        endTime,
        stakeAmount,
        minParticipants
      );

      await expect(
        stravaChallenge.connect(creator).createChallenge(
          challengeId,
          startTime,
          endTime,
          stakeAmount,
          minParticipants
        )
      ).to.be.revertedWith("Challenge already exists");
    });

    it("Should revert if start time is in the past", async function() {
      const currentBlock = await ethers.provider.getBlock('latest');
      const now = currentBlock!.timestamp;
      const pastTime = now - 100;

      await expect(
        stravaChallenge.connect(creator).createChallenge(
          challengeId,
          pastTime,
          endTime,
          stakeAmount,
          minParticipants
        )
      ).to.be.revertedWith("Start time must be in future");
    });

    it("Should revert if end time is before start time", async function() {
      const invalidEndTime = startTime - 100;

      await expect(
        stravaChallenge.connect(creator).createChallenge(
          challengeId,
          startTime,
          invalidEndTime,
          stakeAmount,
          minParticipants
        )
      ).to.be.revertedWith("End time must be after start");
    });

    it("Should revert if stake amount is zero", async function() {
      await expect(
        stravaChallenge.connect(creator).createChallenge(
          challengeId,
          startTime,
          endTime,
          0,
          minParticipants
        )
      ).to.be.revertedWith("Stake must be positive");
    });

    it("Should revert if minimum participants is less than 2", async function() {
      await expect(
        stravaChallenge.connect(creator).createChallenge(
          challengeId,
          startTime,
          endTime,
          stakeAmount,
          1
        )
      ).to.be.revertedWith("Need at least 2 participants");
    });

    it("Should allow multiple different challenges to be created", async function() {
      const challengeId2 = ethers.keccak256(ethers.toUtf8Bytes("test-challenge-2"));
      const startTime2 = startTime + 200;

      await stravaChallenge.connect(creator).createChallenge(
        challengeId,
        startTime,
        endTime,
        stakeAmount,
        minParticipants
      );

      await expect(
        stravaChallenge.connect(creator).createChallenge(
          challengeId2,
          startTime2,
          endTime,
          stakeAmount,
          minParticipants
        )
      ).to.emit(stravaChallenge, "ChallengeCreated");

      const challenge1 = await stravaChallenge.challenges(challengeId);
      const challenge2 = await stravaChallenge.challenges(challengeId2);

      expect(challenge1.startTime).to.equal(startTime);
      expect(challenge2.startTime).to.equal(startTime2);
    });
  });

  describe("Joining Challenges", function() {
    beforeEach(async function() {
      // Create a challenge before each test
      await stravaChallenge.connect(creator).createChallenge(
        challengeId,
        startTime,
        endTime,
        stakeAmount,
        minParticipants
      );
    });

    it("Should allow a user to join with correct stake", async function() {
      const stravaUserId = "strava123";

      await expect(
        stravaChallenge.connect(participant1).joinChallenge(challengeId, stravaUserId, {
          value: stakeAmount
        })
      ).to.emit(stravaChallenge, "ParticipantJoined")
        .withArgs(challengeId, participant1.address, stravaUserId);

      const participant = await stravaChallenge.getParticipant(challengeId, participant1.address);
      expect(participant.userAddress).to.equal(participant1.address);
      expect(participant.stravaUserId).to.equal(stravaUserId);
      expect(participant.stake).to.equal(stakeAmount);
      expect(participant.hasJoined).to.be.true;

      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.totalStaked).to.equal(stakeAmount);
      expect(challenge.participantCount).to.equal(1);
    });

    it("Should add participant to the participant list", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      const participants = await stravaChallenge.getParticipants(challengeId);
      expect(participants).to.have.lengthOf(1);
      expect(participants[0]).to.equal(participant1.address);
    });

    it("Should allow multiple participants to join", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.totalStaked).to.equal(stakeAmount * 2n);
      expect(challenge.participantCount).to.equal(2);

      const participants = await stravaChallenge.getParticipants(challengeId);
      expect(participants).to.have.lengthOf(2);
      expect(participants).to.include(participant1.address);
      expect(participants).to.include(participant2.address);
    });

    it("Should revert if challenge does not exist", async function() {
      const nonExistentId = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));

      await expect(
        stravaChallenge.connect(participant1).joinChallenge(nonExistentId, "strava123", {
          value: stakeAmount
        })
      ).to.be.revertedWith("Challenge does not exist");
    });

    it("Should revert if challenge is not in PENDING state (after start time)", async function() {
      // Join participants first
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      // Move time forward past start time (challenge auto-transitions to ACTIVE)
      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        stravaChallenge.connect(participant3).joinChallenge(challengeId, "strava789", {
          value: stakeAmount
        })
      ).to.be.revertedWith("Challenge not accepting participants");
    });

    it("Should revert if registration period has ended", async function() {
      // Need at least minimum participants for it to not be cancelled
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      // Move time to after start time
      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + 1]);
      await ethers.provider.send("evm_mine", []);

      // Now the challenge is ACTIVE, so joining should fail with "Challenge not accepting participants"
      await expect(
        stravaChallenge.connect(participant3).joinChallenge(challengeId, "strava789", {
          value: stakeAmount
        })
      ).to.be.revertedWith("Challenge not accepting participants");
    });

    it("Should revert if incorrect stake amount is sent", async function() {
      const incorrectStake = ethers.parseEther("0.05");

      await expect(
        stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
          value: incorrectStake
        })
      ).to.be.revertedWith("Incorrect stake amount");
    });

    it("Should revert if user tries to join twice", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      await expect(
        stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
          value: stakeAmount
        })
      ).to.be.revertedWith("Already joined");
    });

    it("Should revert if Strava ID is empty", async function() {
      await expect(
        stravaChallenge.connect(participant1).joinChallenge(challengeId, "", {
          value: stakeAmount
        })
      ).to.be.revertedWith("Invalid Strava ID");
    });
  });

  describe("Lazy State Evaluation", function() {
    beforeEach(async function() {
      await stravaChallenge.connect(creator).createChallenge(
        challengeId,
        startTime,
        endTime,
        stakeAmount,
        minParticipants
      );
    });

    it("Should return PENDING state before start time", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      const effectiveState = await stravaChallenge.getEffectiveState(challengeId);
      expect(effectiveState).to.equal(0); // PENDING
    });

    it("Should return ACTIVE state after start time with enough participants", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      // Move time to start time
      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      const effectiveState = await stravaChallenge.getEffectiveState(challengeId);
      expect(effectiveState).to.equal(1); // ACTIVE

      // Stored state should still be PENDING
      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.state).to.equal(0); // PENDING (stored)
    });

    it("Should return CANCELLED state when minimum participants not met after start", async function() {
      // Only one participant joins (need 2)
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      // Move time to start time
      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      const effectiveState = await stravaChallenge.getEffectiveState(challengeId);
      expect(effectiveState).to.equal(4); // CANCELLED

      // Stored state should still be PENDING until withdrawal
      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.state).to.equal(0); // PENDING (stored)
    });

    it("Should return GRACE_PERIOD state after end time", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      // Move time past end time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
      await ethers.provider.send("evm_mine", []);

      const effectiveState = await stravaChallenge.getEffectiveState(challengeId);
      expect(effectiveState).to.equal(2); // GRACE_PERIOD

      // Stored state should still be PENDING
      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.state).to.equal(0); // PENDING (stored)
    });

    it("Should return stored state for terminal states (FINALIZED)", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      // Move time past end time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
      await ethers.provider.send("evm_mine", []);

      // Oracle finalizes the challenge
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test-data"));
      await stravaChallenge.connect(oracle).finalizeChallenge(
        challengeId,
        participant1.address,
        dataHash
      );

      const effectiveState = await stravaChallenge.getEffectiveState(challengeId);
      expect(effectiveState).to.equal(3); // FINALIZED

      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.state).to.equal(3); // FINALIZED (stored)
    });
  });

  describe("Withdrawal from Cancelled Challenge", function() {
    beforeEach(async function() {
      await stravaChallenge.connect(creator).createChallenge(
        challengeId,
        startTime,
        endTime,
        stakeAmount,
        minParticipants
      );
    });

    it("Should allow participant to withdraw stake from cancelled challenge", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      // Cancel by not meeting minimum participants (move past start time)
      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      const balanceBefore = await ethers.provider.getBalance(participant1.address);

      const tx = await stravaChallenge.connect(participant1).withdrawFromCancelled(challengeId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(participant1.address);

      expect(balanceAfter).to.equal(balanceBefore + stakeAmount - gasUsed);

      // Check participant's stake is now zero
      const participant = await stravaChallenge.getParticipant(challengeId, participant1.address);
      expect(participant.stake).to.equal(0);
    });

    it("Should emit ChallengeCancelled event on first withdrawal", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      // Cancel by not meeting minimum participants
      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      // First withdrawal should emit the event
      await expect(
        stravaChallenge.connect(participant1).withdrawFromCancelled(challengeId)
      ).to.emit(stravaChallenge, "ChallengeCancelled")
        .withArgs(challengeId);

      // Stored state should now be CANCELLED
      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.state).to.equal(4); // CANCELLED
    });

    it("Should update total staked when participant withdraws", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      await stravaChallenge.connect(participant1).withdrawFromCancelled(challengeId);

      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.totalStaked).to.equal(0);
    });

    it("Should revert if challenge is not cancelled (still pending)", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      await expect(
        stravaChallenge.connect(participant1).withdrawFromCancelled(challengeId)
      ).to.be.revertedWith("Challenge not cancelled");
    });

    it("Should revert if participant has no stake", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      // Withdraw once
      await stravaChallenge.connect(participant1).withdrawFromCancelled(challengeId);

      // Try to withdraw again
      await expect(
        stravaChallenge.connect(participant1).withdrawFromCancelled(challengeId)
      ).to.be.revertedWith("No stake to withdraw");
    });

    it("Should revert if user was not a participant", async function() {
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });

      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        stravaChallenge.connect(participant2).withdrawFromCancelled(challengeId)
      ).to.be.revertedWith("No stake to withdraw");
    });
  });
});
