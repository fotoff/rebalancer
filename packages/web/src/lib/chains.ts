import { base } from "viem/chains";

export const supportedChains = [base] as const;
export type SupportedChain = (typeof supportedChains)[number];

export const chainConfig = {
  [base.id]: {
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://mainnet.base.org"] },
    },
  },
};
