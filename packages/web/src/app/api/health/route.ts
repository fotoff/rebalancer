import { NextResponse } from "next/server";
import { dbHealthCheck } from "@/lib/db";

/**
 * A7: Health check endpoint
 * Returns 200 if DB is accessible, 503 otherwise.
 */
export async function GET() {
  const db = dbHealthCheck();

  const status = {
    status: db.ok ? "healthy" : "degraded",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    db: {
      ok: db.ok,
      tables: db.tables,
    },
  };

  return NextResponse.json(status, { status: db.ok ? 200 : 503 });
}
