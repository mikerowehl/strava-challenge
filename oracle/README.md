# Strava Challenge Oracle Service

Backend service that integrates with Strava API and provides oracle signatures for the Strava Challenge smart contract. The oracle tracks participant mileage, collects confirmations during a grace period, and signs finalization data that winners use to claim prizes on-chain.

## Setup

1. Start PostgreSQL:
   ```bash
   docker compose up -d
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. Run the service:
   ```bash
   npm start
   ```

Database tables are created automatically on startup.

## License

MIT
