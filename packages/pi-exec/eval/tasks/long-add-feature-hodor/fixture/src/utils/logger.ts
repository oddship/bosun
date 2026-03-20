import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = "warn";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug(msg: string): void {
    if (shouldLog("debug")) {
      process.stderr.write(`${chalk.gray(timestamp())} ${chalk.gray("DEBUG")} ${msg}\n`);
    }
  },
  info(msg: string): void {
    if (shouldLog("info")) {
      process.stderr.write(`${chalk.gray(timestamp())} ${chalk.blue("INFO")}  ${msg}\n`);
    }
  },
  warn(msg: string): void {
    if (shouldLog("warn")) {
      process.stderr.write(`${chalk.gray(timestamp())} ${chalk.yellow("WARN")}  ${msg}\n`);
    }
  },
  error(msg: string): void {
    if (shouldLog("error")) {
      process.stderr.write(`${chalk.gray(timestamp())} ${chalk.red("ERROR")} ${msg}\n`);
    }
  },
};
