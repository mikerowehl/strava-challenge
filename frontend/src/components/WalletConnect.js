import React from 'react';
import { useWallet } from '../context/WalletContext';

function WalletConnect() {
  const { account, isConnected, connectWallet, disconnect, error, chainId } = useWallet();

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  return (
    <div className="wallet-connect">
      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {!isConnected ? (
        <button onClick={connectWallet} className="btn btn-primary">
          Connect Wallet
        </button>
      ) : (
        <div className="wallet-info">
          <span className="address">{formatAddress(account)}</span>
          <span className="chain-id">Chain: {chainId}</span>
          <button onClick={disconnect} className="btn btn-secondary btn-sm">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default WalletConnect;
