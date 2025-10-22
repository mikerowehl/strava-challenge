import { query } from './db.js';

/**
 * Run all database migrations
 * Creates tables if they don't exist
 */
export async function runMigrations() {
  console.log('Running database migrations...');

  try {
    // Create challenges table
    await query(`
      CREATE TABLE IF NOT EXISTS challenges (
        id INTEGER PRIMARY KEY,
        creator VARCHAR(42) NOT NULL,
        start_time BIGINT NOT NULL,
        end_time BIGINT NOT NULL,
        stake_amount VARCHAR(78) NOT NULL,
        total_staked VARCHAR(78) NOT NULL DEFAULT '0',
        state VARCHAR(20) NOT NULL,
        winner VARCHAR(42),
        final_data_hash VARCHAR(66),
        participant_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('- challenges table ready');

    // Create participants table
    await query(`
      CREATE TABLE IF NOT EXISTS participants (
        challenge_id INTEGER NOT NULL,
        wallet_address VARCHAR(42) NOT NULL,
        strava_user_id VARCHAR(50),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        has_joined BOOLEAN DEFAULT FALSE,
        stake_paid BOOLEAN DEFAULT FALSE,
        confirmed BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (challenge_id, wallet_address)
      )
    `);
    console.log('- participants table ready');

    // Create strava_tokens table
    await query(`
      CREATE TABLE IF NOT EXISTS strava_tokens (
        wallet_address VARCHAR(42) PRIMARY KEY,
        strava_user_id VARCHAR(50) NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        athlete_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('- strava_tokens table ready');

    // Create mileage_snapshots table
    await query(`
      CREATE TABLE IF NOT EXISTS mileage_snapshots (
        id SERIAL PRIMARY KEY,
        challenge_id INTEGER NOT NULL,
        wallet_address VARCHAR(42) NOT NULL,
        strava_user_id VARCHAR(50) NOT NULL,
        total_miles NUMERIC(10, 2) NOT NULL,
        snapshot_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        raw_data JSONB
      )
    `);
    console.log('- mileage_snapshots table ready');

    // Create indexes if they don't exist (using DO block for conditional index creation)
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_participants_challenge') THEN
          CREATE INDEX idx_participants_challenge ON participants(challenge_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_participants_strava') THEN
          CREATE INDEX idx_participants_strava ON participants(strava_user_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_snapshots_challenge') THEN
          CREATE INDEX idx_snapshots_challenge ON mileage_snapshots(challenge_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_snapshots_wallet') THEN
          CREATE INDEX idx_snapshots_wallet ON mileage_snapshots(wallet_address);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_snapshots_time') THEN
          CREATE INDEX idx_snapshots_time ON mileage_snapshots(snapshot_at);
        END IF;
      END
      $$;
    `);
    console.log('- indexes ready');

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  }
}
