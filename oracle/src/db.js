import pg from 'pg';
import dotenv from 'dotenv';
import { runMigrations } from './migrations.js';

dotenv.config();

const { Pool } = pg;

// Create PostgreSQL connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection and run migrations
export async function setupDatabase() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('Database connected at:', result.rows[0].now);
    client.release();

    // Run migrations to ensure all tables exist
    await runMigrations();

    return true;
  } catch (error) {
    console.error('Database setup error:', error);
    throw error;
  }
}

// Helper function to execute queries
export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Query error:', error);
    throw error;
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing database pool');
  await pool.end();
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing database pool');
  await pool.end();
  process.exit(0);
});
