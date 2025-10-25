import type { HardhatUserConfig } from "hardhat/config";

import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable } from "hardhat/config";

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
      accounts: [
        {
          privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
          balance: "10000000000000000000000", // 10000 ETH
        },
        {
          privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
          balance: "10000000000000000000000", // 10000 ETH
        },
      ],
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
      accounts: [
        {
          privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
          balance: "10000000000000000000000", // 10000 ETH
        },
        {
          privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
          balance: "10000000000000000000000", // 10000 ETH
        },
      ],
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [
        configVariable("SEPOLIA_PRIVATE_KEY"),
        configVariable("SEPOLIA_ORACLE_PRIVATE_KEY"),
      ],
    },
  },
};

export default config;
