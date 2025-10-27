# Strava Challenge

A staking app based on a mileage challenge tracked off-chain. The flow is:

* The challenger creates the challenge and sets the parameters - who can
participate, when the challenge starts and ends, and how much each participant
has to contribute.
* Everyone joins, connects their Strava account to track mileage, and funds
the challenge.
* When the challenge is active a leaderboard is displayed.
* Once the challenge has ended, everyone can confirm their mileage to the oracle
with an off-chain signed message to confirm that all their Strava activity is
uploaded and their mileage is final.
* When everyone has confirmed - or 7 days later if not everyone confirms - the
winner can claim their prize using a signed message from the oracle.
* If, for some reason, the prize isn't claimed within 14 days of the challenge
ending, there's an escape hatch provided so that participants can cancel the
challenge and withdraw their stake.

## Local Operation

The example configuration has been populated with all the correct config to 
use local services and to connect to the static accounts provided when Hardhat
is running locally. The contract owner is signer[0] and the oracle is setup
using signer[1]. Just copy `.env.example` to `.env` for each service and run. The
default also uses a mocked Strava service described below to make testing
easier.

## Mock Strava Service

If `MOCK_STRAVA` is set to `true` for the Oracle and the frontend they use a
mocked version instead of actually calling out to Strava. Instead of popping
up the auth window on initial connection it just shows a message saying that
the dev mode of Strava is being used, and we insert a dummy record in place
of the tokens that normally come back from Strava. And if the user has that
dummy record and the oracle is setup for mocked mileage the user can just
directly set their mileage on the challenge page.

## Time Manipulation

Needing to wait for challenges to start and end - and potentially having to
wait for grace periods or emergency claim periods to pass - would make testing
the challenges in real time pretty difficult. There are a few scripts in
the Hardhat project to make moving the blockchain time easier:

* `get-time.ts` - output the time of the latest block
* `increase-time.ts` - move the time offset forward and mine a block
* `mine-block.ts` - just mine a block to sync the time if it's been a while
    since we mined

Note however that the ethers and wallet cache can keep the browser from 
realizing the time has updated if we force it forward unnaturally. I
normally swap to another account and back to make sure it picks up the time
change.
