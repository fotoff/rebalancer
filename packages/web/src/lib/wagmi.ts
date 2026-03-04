import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  rainbowWallet,
  walletConnectWallet,
  injectedWallet,
  coinbaseWallet,
  rabbyWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, fallback } from "wagmi";
import { base } from "viem/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        injectedWallet,
        rainbowWallet,
        walletConnectWallet,
        coinbaseWallet,
        rabbyWallet,
      ],
    },
  ],
  { appName: "Rebalancer", projectId }
);

export const config = createConfig({
  connectors,
  chains: [base],
  batch: {
    multicall: {
      wait: 50,
    },
  },
  transports: {
    [base.id]: fallback([
      http("https://mainnet.base.org"),
      http("https://base.llamarpc.com"),
      http("https://1rpc.io/base"),
    ]),
  },
});
