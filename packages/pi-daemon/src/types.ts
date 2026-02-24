/**
 * pi-daemon type definitions.
 */

// --- Config types (from .pi/daemon.json) ---

export interface WatcherConfig {
  /** Unique watcher name (referenced by rules). */
  name: string;
  /** Glob pattern relative to cwd (e.g., "sessions/**\/*.jsonl"). */
  pattern: string;
  /** Debounce time in milliseconds. */
  debounce_ms: number;
}

export interface RuleConfig {
  /** Unique rule name. */
  name: string;
  /** Watcher name that triggers this rule (mutually exclusive with schedule). */
  trigger?: string;
  /** Schedule: "hourly", "daily:HH" (e.g., "daily:02" = 2 AM). */
  schedule?: string;
  /** Handler name — maps to handler_dir/{name}.ts. */
  handler: string;
  /** Minimum minutes since trigger before rule fires (for debounce). */
  stale_minutes?: number;
}

export interface DaemonConfig {
  /** Whether the daemon is enabled. */
  enabled: boolean;
  /** Directory containing handler .ts files (relative to cwd). */
  handlers_dir: string;
  /** Heartbeat interval in seconds. */
  heartbeat_interval_seconds: number;
  /** Directory for daemon state files (relative to cwd). */
  state_dir: string;
  /** Log level. */
  log_level: "debug" | "info" | "warn" | "error";
  /** File watchers. */
  watchers: WatcherConfig[];
  /** Rules. */
  rules: RuleConfig[];
}

// --- Runtime types ---

export interface TriggerRecord {
  path: string;
  event: "add" | "change";
  timestamp: string;
  watcher: string;
}

export interface TriggersState {
  pending: TriggerRecord[];
  last_processed: string | null;
}

export interface RuleRunRecord {
  last_run: string;
  last_result: "success" | "failed" | "running";
  last_error?: string;
}

export type RulesState = Record<string, RuleRunRecord>;

export interface QueuedTask {
  id: string;
  rule: string;
  handler: string;
  context: Record<string, unknown>;
  priority: "high" | "normal" | "low";
}

export interface QueueEntry extends QueuedTask {
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  started_at?: string;
  completed_at?: string;
  attempts: number;
  max_attempts: number;
  last_error?: string;
  backoff_until?: string;
}

export interface Queue {
  tasks: QueueEntry[];
  history: QueueEntry[];
  max_history: number;
}

export interface HandlerContext {
  /** Task ID for checkpoint support. */
  _task_id?: string;
  /** Rule name that triggered this handler. */
  _rule?: string;
  /** Handler name. */
  _handler?: string;
  /** Arbitrary context from rule evaluation. */
  [key: string]: unknown;
}

/** Handler function signature. Exported by handler .ts files as default. */
export type HandlerFn = (context: HandlerContext) => Promise<void>;

export interface DaemonStatus {
  running: boolean;
  pid: number;
  started_at: string;
  heartbeat: string;
  watchers: Array<{
    name: string;
    pattern: string;
    enabled: boolean;
    last_triggered: string | null;
  }>;
  stats: {
    handlers_run: number;
    errors: number;
  };
}
