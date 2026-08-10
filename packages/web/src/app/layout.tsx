import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rebalancer — AI-Powered Token Rebalancing on Base",
  description:
    "Automatic non-custodial token rebalancing on Base L2. AI advisor, smart triggers, real-time price monitoring. Set and forget.",
  other: {
    // Base app domain verification
    "base:app_id": "6a50dca11af1f180d46a8795",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
