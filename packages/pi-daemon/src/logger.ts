/**
 * Simple daemon logger with file output.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";
let logFilePath: string | null = null;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setLogFile(path: string): void {
  logFilePath = path;
  mkdirSync(dirname(path), { recursive: true });
}

function log(level: LogLevel, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  // Always write to stderr
  process.stderr.write(line + "\n");

  // Append to log file if configured
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line + "\n");
    } catch {
      // Silently ignore log file write failures
    }
  }
}

export function debug(message: string): void {
  log("debug", message);
}

export function info(message: string): void {
  log("info", message);
}

export function warn(message: string): void {
  log("warn", message);
}

export function error(message: string): void {
  log("error", message);
}
