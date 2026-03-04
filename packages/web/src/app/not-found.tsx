import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold text-white">404</h1>
      <p className="text-white/60">Page not found</p>
      <Link
        href="/"
        className="rounded-lg bg-[#0052FF] px-6 py-2 font-medium text-white hover:bg-[#0046e0]"
      >
        Back to home
      </Link>
    </div>
  );
}
