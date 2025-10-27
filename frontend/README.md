# Strava Challenge Web Frontend

Web3 client that uses a browser wallet to interface with the StravaChallenge smart contract and the off-chain oracle used to track mileage.

## Setup

1. Compile the contracts in the parent Hardhat project, copies artifacts into this project for interfacing with the contract
   ```bash
   npx hardhat compile
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env to suit your setup, no changes needed when running locally
   ```

4. Run the service:
   ```bash
   npm start
   ```

## License

MIT
