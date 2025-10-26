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
  let challengeId: number;
  let startTime: number;
  let endTime: number;
  const stakeAmount = ethers.parseEther("0.1");
  let allowedAddresses: string[];

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

    // Set up allowed participants (participant1 and participant2 by default)
    allowedAddresses = [participant1.address, participant2.address];
  });

  describe("Deployment", function() {
    it("Should set the correct oracle address", async function() {
      expect(await stravaChallenge.oracle()).to.equal(oracle.address);
    });
  });

  describe("Challenge Creation", function() {
    it("Should create a challenge with valid parameters", async function() {
      const tx = await stravaChallenge.connect(creator).createChallenge(
        startTime,
        endTime,
        stakeAmount,
        allowedAddresses
      );

      const receipt = await tx.wait();
      const event = receipt!.logs.find((log: any) => {
        try {
          return stravaChallenge.interface.parseLog(log)?.name === "ChallengeCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = stravaChallenge.interface.parseLog(event!);
      challengeId = parsedEvent!.args[0]; // First arg is challengeId

      expect(challengeId).to.equal(0); // First challenge has ID 0

      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.id).to.equal(challengeId);
      expect(challenge.creator).to.equal(creator.address);
      expect(challenge.startTime).to.equal(startTime);
      expect(challenge.endTime).to.equal(endTime);
      expect(challenge.stakeAmount).to.equal(stakeAmount);
      expect(challenge.totalStaked).to.equal(0);
      expect(challenge.state).to.equal(0); // PENDING
      expect(challenge.participantCount).to.equal(0);

      // Verify whitelist (creator is automatically included)
      const allowedList = await stravaChallenge.getAllowedParticipants(challengeId);
      expect(allowedList).to.have.lengthOf(3);
      expect(allowedList).to.include(creator.address); // Creator auto-included
      expect(allowedList).to.include(participant1.address);
      expect(allowedList).to.include(participant2.address);
    });

    it("Should allow multiple challenges to be created with auto-incrementing IDs", async function() {
      const tx1 = await stravaChallenge.connect(creator).createChallenge(
        startTime,
        endTime,
        stakeAmount,
        allowedAddresses
      );
      const receipt1 = await tx1.wait();
      const event1 = receipt1!.logs.find((log: any) => {
        try {
          return stravaChallenge.interface.parseLog(log)?.name === "ChallengeCreated";
        } catch {
          return false;
        }
      });
      const id1 = stravaChallenge.interface.parseLog(event1!)!.args[0];

      const tx2 = await stravaChallenge.connect(creator).createChallenge(
        startTime + 100,
        endTime,
        stakeAmount,
        allowedAddresses
      );
      const receipt2 = await tx2.wait();
      const event2 = receipt2!.logs.find((log: any) => {
        try {
          return stravaChallenge.interface.parseLog(log)?.name === "ChallengeCreated";
        } catch {
          return false;
        }
      });
      const id2 = stravaChallenge.interface.parseLog(event2!)!.args[0];

      expect(id1).to.equal(0);
      expect(id2).to.equal(1);
    });

    it("Should revert if start time is in the past", async function() {
      const currentBlock = await ethers.provider.getBlock('latest');
      const now = currentBlock!.timestamp;
      const pastTime = now - 100;

      await expect(
        stravaChallenge.connect(creator).createChallenge(
          pastTime,
          endTime,
          stakeAmount,
          allowedAddresses
        )
      ).to.be.revertedWith("Start time must be in future");
    });

    it("Should revert if end time is before start time", async function() {
      const invalidEndTime = startTime - 100;

      await expect(
        stravaChallenge.connect(creator).createChallenge(
          startTime,
          invalidEndTime,
          stakeAmount,
          allowedAddresses
        )
      ).to.be.revertedWith("End time must be after start");
    });

    it("Should revert if stake amount is zero", async function() {
      await expect(
        stravaChallenge.connect(creator).createChallenge(
          startTime,
          endTime,
          0,
          allowedAddresses
        )
      ).to.be.revertedWith("Stake must be positive");
    });

    it("Should revert if allowed participants list has less than 1 address", async function() {
      await expect(
        stravaChallenge.connect(creator).createChallenge(
          startTime,
          endTime,
          stakeAmount,
          [] // Empty array - creator is automatically included, but need at least 1 other
        )
      ).to.be.revertedWith("Need at least 1 other participant");
    });

    it("Should revert if whitelist contains zero address", async function() {
      await expect(
        stravaChallenge.connect(creator).createChallenge(
          startTime,
          endTime,
          stakeAmount,
          [participant1.address, ethers.ZeroAddress]
        )
      ).to.be.revertedWith("Invalid address in whitelist");
    });

    it("Should revert if whitelist contains duplicate addresses", async function() {
      await expect(
        stravaChallenge.connect(creator).createChallenge(
          startTime,
          endTime,
          stakeAmount,
          [participant1.address, participant1.address]
        )
      ).to.be.revertedWith("Duplicate address in whitelist");
    });
  });

  describe("Joining Challenges", function() {
    beforeEach(async function() {
      // Create a challenge before each test
      challengeId = await stravaChallenge.connect(creator).createChallenge.staticCall(
        startTime,
        endTime,
        stakeAmount,
        allowedAddresses
      );
      await stravaChallenge.connect(creator).createChallenge(
        startTime,
        endTime,
        stakeAmount,
        allowedAddresses
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
      const nonExistentId = 999; // Far beyond any created challenge

      await expect(
        stravaChallenge.connect(participant1).joinChallenge(nonExistentId, "strava123", {
          value: stakeAmount
        })
      ).to.be.revertedWith("Challenge does not exist");
    });

    it("Should revert if challenge is not in PENDING state (after start time)", async function() {
      // Join both whitelisted participants first
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      // Move time forward past start time (challenge auto-transitions to ACTIVE)
      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime]);
      await ethers.provider.send("evm_mine", []);

      // Now the challenge is ACTIVE - even a whitelisted user can't join
      // But participant1 already joined, so they should get "Already joined"
      await expect(
        stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava-new", {
          value: stakeAmount
        })
      ).to.be.revertedWith("Challenge not accepting participants");
    });

    it("Should revert if registration period has ended", async function() {
      // Join all whitelisted participants
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      // Move time to after start time
      await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + 1]);
      await ethers.provider.send("evm_mine", []);

      // Now the challenge is ACTIVE - even a whitelisted user can't join
      await expect(
        stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava-new-id", {
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

    it("Should revert if user is not on the whitelist", async function() {
      await expect(
        stravaChallenge.connect(participant3).joinChallenge(challengeId, "strava789", {
          value: stakeAmount
        })
      ).to.be.revertedWith("Not on whitelist");
    });
  });

  describe("Lazy State Evaluation", function() {
    beforeEach(async function() {
      challengeId = await stravaChallenge.connect(creator).createChallenge.staticCall(
        startTime,
        endTime,
        stakeAmount,
        allowedAddresses
      );
      await stravaChallenge.connect(creator).createChallenge(
        startTime,
        endTime,
        stakeAmount,
        allowedAddresses
      );
    });

    it("Should return PENDING state before start time", async function() {
      // Creator is auto-included, so all 3 need to join
      await stravaChallenge.connect(creator).joinChallenge(challengeId, "strava_creator", {
        value: stakeAmount
      });
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
      // Creator is auto-included, so all 3 need to join
      await stravaChallenge.connect(creator).joinChallenge(challengeId, "strava_creator", {
        value: stakeAmount
      });
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
      expect(effectiveState).to.equal(3); // CANCELLED

      // Stored state should still be PENDING until withdrawal
      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.state).to.equal(0); // PENDING (stored)
    });

    it("Should return GRACE_PERIOD state after end time", async function() {
      // Creator is auto-included, so all 3 need to join
      await stravaChallenge.connect(creator).joinChallenge(challengeId, "strava_creator", {
        value: stakeAmount
      });
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

    it("Should return stored state for terminal states (COMPLETED)", async function() {
      // Creator is auto-included, so all 3 need to join
      await stravaChallenge.connect(creator).joinChallenge(challengeId, "strava_creator", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant1).joinChallenge(challengeId, "strava123", {
        value: stakeAmount
      });
      await stravaChallenge.connect(participant2).joinChallenge(challengeId, "strava456", {
        value: stakeAmount
      });

      // Move time past end time
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
      await ethers.provider.send("evm_mine", []);

      // Get current timestamp for signature
      const currentBlock = await ethers.provider.getBlock('latest');
      const timestamp = currentBlock!.timestamp;

      // Create oracle signature for finalization
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test-data"));
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ["string", "uint256", "address", "bytes32", "uint256"],
          ["FINALIZE_CHALLENGE_", challengeId, participant1.address, dataHash, timestamp]
        )
      );
      const signature = await oracle.signMessage(ethers.getBytes(messageHash));

      // Winner claims with signature (this finalizes and completes in one tx)
      await stravaChallenge.connect(participant1).claimPrizeWithSignature(
        challengeId,
        participant1.address,
        dataHash,
        timestamp,
        signature
      );

      const effectiveState = await stravaChallenge.getEffectiveState(challengeId);
      expect(effectiveState).to.equal(4); // COMPLETED

      const challenge = await stravaChallenge.challenges(challengeId);
      expect(challenge.state).to.equal(4); // COMPLETED (stored)
    });
  });

  describe("Withdrawal from Cancelled Challenge", function() {
    beforeEach(async function() {
      challengeId = await stravaChallenge.connect(creator).createChallenge.staticCall(
        startTime,
        endTime,
        stakeAmount,
        allowedAddresses
      );
      await stravaChallenge.connect(creator).createChallenge(
        startTime,
        endTime,
        stakeAmount,
        allowedAddresses
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
      expect(challenge.state).to.equal(3); // CANCELLED
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
