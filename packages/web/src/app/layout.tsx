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
    // Talent Protocol (Builder Score) project verification
    "talentapp:project_verification":
      "a9b9ff5550ac75668e044813d31f925e1d8de735509a069fa2304bc6406bc2fce26c658d3d8cb99a837398143307c3333c09ee3402e467055ceceb94abacb476",
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
