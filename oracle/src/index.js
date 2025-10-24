import express from 'express';
import dotenv from 'dotenv';
import { setupDatabase } from './db.js';
import { oracleRouter } from './routes/oracle.js';
import { stravaRouter } from './routes/strava.js';
import { challengesRouter } from './routes/challenges.js';
import { participantsRouter } from './routes/participants.js';
import { devRouter } from './routes/dev.js';
import { startCronJobs } from './cron.js';
import { startEventListener, stopEventListener } from './event-listener.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware - allow requests from frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/oracle', oracleRouter);
app.use('/auth/strava', stravaRouter);
app.use('/challenges', challengesRouter);
app.use('/participants', participantsRouter);
app.use('/dev', devRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
async function start() {
  try {
    // Initialize database connection
    await setupDatabase();
    console.log('Database connected');

    // Start blockchain event listener
    await startEventListener();

    // Start cron jobs
    startCronJobs();

    // Start listening
    app.listen(PORT, () => {
      console.log(`Oracle service running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health`);
      console.log(`   Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await stopEventListener();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await stopEventListener();
  process.exit(0);
});

start();
