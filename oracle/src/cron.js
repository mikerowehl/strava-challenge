import cron from 'node-cron';
import { syncActiveChallenges } from './sync-service.js';

/**
 * Start the hourly sync job
 * Runs at the top of every hour
 */
export function startCronJobs() {
  // Run every hour at minute 0
  // Cron format: "minute hour day month weekday"
  cron.schedule('0 * * * *', async () => {
    console.log('Running hourly sync job');
    try {
      const result = await syncActiveChallenges();
      console.log('Hourly sync complete:', result);
    } catch (error) {
      console.error('Hourly sync failed:', error);
    }
  });

  console.log('Cron jobs started - hourly sync enabled');
}
