import React, { useState, useEffect } from 'react';
import { getLeaderboard } from '../utils/api';

function Leaderboard({ challengeId }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    fetchLeaderboard();
    // Refresh every 60 seconds
    const interval = setInterval(fetchLeaderboard, 60000);
    return () => clearInterval(interval);
  }, [challengeId]);

  const fetchLeaderboard = async () => {
    try {
      setError(null);
      const data = await getLeaderboard(challengeId);
      setLeaderboard(data.leaderboard || []);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
      setError('No leaderboard data available yet');
      setLeaderboard([]);
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  };

  if (loading) {
    return <div className="leaderboard">Loading leaderboard...</div>;
  }

  if (error && leaderboard.length === 0) {
    return (
      <div className="leaderboard">
        <h3>Leaderboard</h3>
        <p className="info">{error}</p>
      </div>
    );
  }

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <h3>Leaderboard</h3>
        {lastUpdate && (
          <small>Last updated: {lastUpdate.toLocaleTimeString(undefined, { timeZoneName: 'short' })}</small>
        )}
      </div>

      {leaderboard.length === 0 ? (
        <p className="info">No participants have data yet. Activities will be synced hourly.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Address</th>
              <th>Miles</th>
              <th>Last Update</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry) => (
              <tr key={entry.address} className={entry.rank === 1 ? 'winner' : ''}>
                <td>{entry.rank}</td>
                <td>{formatAddress(entry.address)}</td>
                <td>{entry.miles.toFixed(2)}</td>
                <td>{formatDate(entry.lastUpdate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button onClick={fetchLeaderboard} className="btn btn-secondary btn-sm">
        Refresh
      </button>
    </div>
  );
}

export default Leaderboard;
