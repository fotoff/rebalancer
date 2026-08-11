import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Money and token amounts are pinned to en-US on purpose.
 *
 * `toLocaleString()` with no locale follows the reader's browser, so on a
 * comma-decimal locale $1.879 renders as "$1,879" — which an English reader
 * takes for one thousand eight hundred. Prices elsewhere in the app are plain
 * JS numbers with a period, so the two formats also collided inside one table.
 * A dollar figure has to mean the same thing to everyone who sees a screenshot.
 */
const USD = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a USD amount. Sub-cent values keep enough digits to stay meaningful. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (n !== 0 && Math.abs(n) < 0.01) {
    return `$${n.toLocaleString("en-US", { maximumSignificantDigits: 2 })}`;
  }
  return `$${USD.format(n)}`;
}

/** Format a token quantity — same locale pinning, but amount-appropriate digits. */
export function formatAmount(n: number, maxDigits = 6): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDigits });
}
