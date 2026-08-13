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
    // Our proxy first: it fronts a provider that does not rate-limit us, and
    // keeps the API key server-side. The public endpoints stay as a fallback
    // for when our own server is the thing that is down — but they refuse
    // often enough that leading with them made viem report the failure as
    // "No internet connection detected", which blamed the user's network for
    // our transport choice.
    [base.id]: fallback([
      http("/api/rpc"),
      http("https://base.llamarpc.com"),
      http("https://1rpc.io/base"),
      http("https://mainnet.base.org"),
    ]),
  },
});
