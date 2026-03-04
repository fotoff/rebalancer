import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native Node module — exclude from webpack bundling
  serverExternalPackages: ["better-sqlite3"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.dexscreener.com" },
      { protocol: "https", hostname: "assets.coingecko.com" },
      { protocol: "https", hostname: "raw.githubusercontent.com" },
    ],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**"],
        poll: 1000,
      };
    }
    // MetaMask SDK pulls in React Native async-storage; stub it for web
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": path.resolve(
        __dirname,
        "src/lib/async-storage-stub.js"
      ),
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "pino-pretty": false,
    };
    return config;
  },
};

export default nextConfig;
