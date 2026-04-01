require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "0".repeat(64);
const AMOY_RPC    = process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    polygon_amoy: {
      url: AMOY_RPC,
      chainId: 80002,
      accounts: [PRIVATE_KEY],
    },
    hardhat: {
      chainId: 31337,
    },
  },
  paths: {
    sources:   "./contracts",
    artifacts: "./artifacts",
    cache:     "./cache",
  },
};
