import React, { createContext, useState, useEffect, useContext } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../utils/contract';

const WalletContext = createContext();

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [error, setError] = useState(null);

  // Initialize provider on mount
  useEffect(() => {
    if (window.ethereum) {
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      setProvider(web3Provider);

      // Check if already connected
      window.ethereum.request({ method: 'eth_accounts' })
        .then(accounts => {
          if (accounts.length > 0) {
            connectWallet();
          }
        })
        .catch(console.error);

      // Listen for account changes
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, []);

  // Handle account changes
  const handleAccountsChanged = (accounts) => {
    if (accounts.length === 0) {
      disconnect();
    } else {
      connectWallet();
    }
  };

  // Handle chain changes
  const handleChainChanged = () => {
    window.location.reload();
  };

  // Connect wallet
  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        setError('MetaMask is not installed. Please install MetaMask to use this app.');
        return;
      }

      setError(null);
      const web3Provider = new ethers.BrowserProvider(window.ethereum);

      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });

      const walletSigner = await web3Provider.getSigner();
      const network = await web3Provider.getNetwork();

      setAccount(accounts[0]);
      setProvider(web3Provider);
      setSigner(walletSigner);
      setChainId(Number(network.chainId));

      // Initialize contract if address is set
      if (CONTRACT_ADDRESS) {
        const contractInstance = new ethers.Contract(
          CONTRACT_ADDRESS,
          CONTRACT_ABI,
          walletSigner
        );
        setContract(contractInstance);
      }

    } catch (err) {
      console.error('Error connecting wallet:', err);
      setError(err.message);
    }
  };

  // Disconnect wallet
  const disconnect = () => {
    setAccount(null);
    setSigner(null);
    setContract(null);
    setError(null);
  };

  // Get contract with read-only provider (for non-connected users)
  const getReadOnlyContract = () => {
    if (!CONTRACT_ADDRESS) return null;

    // Use a public RPC or the connected provider
    const readProvider = provider || new ethers.JsonRpcProvider(
      process.env.REACT_APP_RPC_URL || 'http://localhost:8545'
    );

    return new ethers.Contract(
      CONTRACT_ADDRESS,
      CONTRACT_ABI,
      readProvider
    );
  };

  const value = {
    account,
    provider,
    signer,
    contract,
    chainId,
    error,
    isConnected: !!account,
    connectWallet,
    disconnect,
    getReadOnlyContract
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}
