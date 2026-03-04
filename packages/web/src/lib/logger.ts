/**
 * A6: Structured JSON logging
 * Outputs JSON lines with timestamp, level, context, and message.
 * Easy to parse with log aggregators (Grafana/Loki, Datadog, etc.)
 */

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  ctx: string;
  msg: string;
  data?: unknown;
}

function emit(level: LogLevel, ctx: string, msg: string, data?: unknown) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    ctx,
    msg,
  };
  if (data !== undefined) entry.data = data;

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (ctx: string, msg: string, data?: unknown) =>
    emit("info", ctx, msg, data),
  warn: (ctx: string, msg: string, data?: unknown) =>
    emit("warn", ctx, msg, data),
  error: (ctx: string, msg: string, data?: unknown) =>
    emit("error", ctx, msg, data),
};
