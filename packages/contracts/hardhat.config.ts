import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Set FORK=1 to fork Base mainnet in-process (validates deploy against real
    // Chainlink feeds / routers before spending real ETH). Requires BASE_RPC_URL.
    hardhat:
      process.env.FORK === "1"
        ? { forking: { url: process.env.BASE_RPC_URL || "https://mainnet.base.org" }, chainId: 8453 }
        : {},
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  // A8: BaseScan verification (Etherscan V2 API)
  // Get free API key at https://basescan.org/myapikey
  etherscan: {
    apiKey: process.env.BASESCAN_API_KEY || "",
  },
};

export default config;
