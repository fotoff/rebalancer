/**
 * Public identity of the project: who builds it and where to reach them.
 *
 * This is not decoration. tokenrebalancer.com sits on MetaMask's phishing
 * blocklist, and the appeal (eth-phishing-detect#227599) was rejected with a
 * specific reason: no social presence linked from the site, no identifiable
 * team. Anonymity is indistinguishable from a scam to a reviewer, so these
 * links are part of being trustable, not marketing.
 */

export const SOCIALS = [
  { label: "X", handle: "@wardarc", href: "https://x.com/wardarc" },
  {
    label: "Farcaster",
    handle: "wardarc",
    href: "https://farcaster.xyz/wardarc",
  },
  {
    label: "GitHub",
    handle: "fotoff/rebalancer",
    href: "https://github.com/fotoff/rebalancer",
  },
] as const;

/** Discord is a username, not an address — shown as a handle, not a link. */
export const DISCORD_HANDLE = "wardarc";

/** Inline row for footers. */
export function SocialLinks({ className = "" }: { className?: string }) {
  return (
    <span className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {SOCIALS.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer me"
          className="hover:text-foreground hover:underline"
        >
          {s.label}
        </a>
      ))}
      <span className="text-muted-foreground/70">Discord {DISCORD_HANDLE}</span>
    </span>
  );
}

/** Named card for the landing page — states who is behind the project. */
export function BuiltBy() {
  return (
    <section className="mx-auto max-w-4xl px-4 pb-12">
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <h3 className="text-sm font-semibold text-foreground">
          Built in the open by{" "}
          <a
            href="https://x.com/wardarc"
            target="_blank"
            rel="noopener noreferrer me"
            className="underline underline-offset-4"
          >
            @wardarc
          </a>
        </h3>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Every contract is verified on BaseScan and the whole application is
          public on GitHub — the code doing the rebalancing is the code you can
          read. Questions and bug reports are welcome on any of these.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer me"
              className="text-foreground hover:underline"
            >
              {s.label}{" "}
              <span className="text-muted-foreground">{s.handle}</span>
            </a>
          ))}
          <span className="text-foreground">
            Discord <span className="text-muted-foreground">{DISCORD_HANDLE}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
