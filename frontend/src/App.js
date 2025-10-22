import React, { useState, useEffect } from 'react';
import { WalletProvider } from './context/WalletContext';
import WalletConnect from './components/WalletConnect';
import CreateChallenge from './components/CreateChallenge';
import ChallengeView from './components/ChallengeView';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [challengeId, setChallengeId] = useState(null);

  useEffect(() => {
    // Simple hash-based routing
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // Remove #

      if (hash.startsWith('/challenge/')) {
        const id = hash.split('/')[2];
        setChallengeId(id);
        setCurrentView('challenge');
      } else if (hash === '/create') {
        setCurrentView('create');
      } else {
        setCurrentView('home');
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (view, id = null) => {
    if (view === 'challenge' && id) {
      window.location.hash = `/challenge/${id}`;
    } else if (view === 'create') {
      window.location.hash = '/create';
    } else {
      window.location.hash = '/';
    }
  };

  return (
    <WalletProvider>
      <div className="App">
        <header>
          <h1>Strava Challenge dApp</h1>
          <nav>
            <button onClick={() => navigate('home')} className="nav-link">
              Home
            </button>
            <button onClick={() => navigate('create')} className="nav-link">
              Create Challenge
            </button>
          </nav>
          <WalletConnect />
        </header>

        <main>
          {currentView === 'home' && <HomePage navigate={navigate} />}
          {currentView === 'create' && <CreateChallenge />}
          {currentView === 'challenge' && challengeId && (
            <ChallengeView challengeId={parseInt(challengeId)} />
          )}
        </main>

        <footer>
          <p>A decentralized Strava challenge platform on Ethereum</p>
        </footer>
      </div>
    </WalletProvider>
  );
}

function HomePage({ navigate }) {
  const [challengeIdInput, setChallengeIdInput] = useState('');

  const handleViewChallenge = (e) => {
    e.preventDefault();
    if (challengeIdInput) {
      navigate('challenge', challengeIdInput);
    }
  };

  return (
    <div className="home">
      <section className="hero">
        <h2>Welcome to Strava Challenge</h2>
        <p>
          Create and join mileage challenges with your friends. Stake ETH,
          compete on Strava, and the winner takes all!
        </p>
      </section>

      <section className="how-it-works">
        <h3>How It Works</h3>
        <ol>
          <li>
            <strong>Create a Challenge</strong> - Set the time window, stake amount,
            and invite participants by their Ethereum addresses
          </li>
          <li>
            <strong>Connect Strava</strong> - Participants connect their Strava
            accounts and join by paying the stake
          </li>
          <li>
            <strong>Compete</strong> - During the challenge period, run/cycle and
            log activities on Strava. The leaderboard updates hourly
          </li>
          <li>
            <strong>Win</strong> - After the challenge ends and a 7-day grace
            period, the winner claims the entire prize pool
          </li>
        </ol>
      </section>

      <section className="actions">
        <div className="action-card">
          <h3>Create a Challenge</h3>
          <p>Start a new challenge and invite your friends to compete</p>
          <button onClick={() => navigate('create')} className="btn btn-primary">
            Create Challenge
          </button>
        </div>

        <div className="action-card">
          <h3>View a Challenge</h3>
          <p>Enter a challenge ID to view details and join</p>
          <form onSubmit={handleViewChallenge}>
            <input
              type="number"
              placeholder="Challenge ID"
              value={challengeIdInput}
              onChange={(e) => setChallengeIdInput(e.target.value)}
              min="0"
            />
            <button type="submit" className="btn btn-secondary">
              View Challenge
            </button>
          </form>
        </div>
      </section>

      <section className="info">
        <h3>Key Features</h3>
        <ul>
          <li>Trustless prize distribution via smart contracts</li>
          <li>Automatic activity tracking from Strava</li>
          <li>7-day grace period after challenges end</li>
          <li>Emergency withdrawal if oracle fails</li>
        </ul>
      </section>
    </div>
  );
}

export default App;
