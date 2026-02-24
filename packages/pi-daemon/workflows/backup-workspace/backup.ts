/**
 * Backup script — creates daily tar.gz snapshots.
 *
 * Pure filesystem operations, no LLM needed.
 * Ported from scripts/daemon/handlers/backup-workspace.ts.
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join, relative } from "path";
import { execSync } from "child_process";

const BOSUN_ROOT = process.env.BOSUN_ROOT || process.cwd();

interface BackupConfig {
  enabled: boolean;
  destination: string;
  retention_days: number;
  max_backups: number;
  targets: Array<{ name: string; paths: string[] }>;
}

function loadBackupConfig(): BackupConfig {
  const defaults: BackupConfig = {
    enabled: true,
    destination: "workspace/backups",
    retention_days: 30,
    max_backups: 30,
    targets: [
      { name: "workspace", paths: ["workspace/users"] },
      { name: "config", paths: [".pi/agents", "config.toml"] },
    ],
  };

  try {
    const configPath = join(BOSUN_ROOT, ".pi", "daemon.json");
    if (!existsSync(configPath)) return defaults;
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const backup = config.backup;
    if (!backup) return defaults;

    return {
      enabled: backup.enabled ?? defaults.enabled,
      destination: backup.destination || defaults.destination,
      retention_days: backup.retention_days ?? defaults.retention_days,
      max_backups: backup.max_backups ?? defaults.max_backups,
      targets: Array.isArray(backup.targets) ? backup.targets : defaults.targets,
    };
  } catch {
    return defaults;
  }
}

function resolveBackupPaths(targets: Array<{ paths: string[] }>): string[] {
  const allPaths = new Set<string>();
  for (const target of targets) {
    for (const pattern of target.paths) {
      const absPath = join(BOSUN_ROOT, pattern);
      if (existsSync(absPath)) {
        const rel = relative(BOSUN_ROOT, absPath);
        if (rel && !rel.startsWith("..")) allPaths.add(rel);
      }
    }
  }
  return Array.from(allPaths).sort();
}

function pruneBackups(destDir: string, retentionDays: number, maxBackups: number): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let pruned = 0;

  try {
    const files = readdirSync(destDir)
      .filter(f => f.startsWith("backup-") && f.endsWith(".tar.gz"))
      .map(f => ({
        name: f,
        path: join(destDir, f),
        mtime: statSync(join(destDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    for (let i = 0; i < files.length; i++) {
      if (i >= maxBackups || files[i].mtime < cutoff) {
        unlinkSync(files[i].path);
        pruned++;
      }
    }
  } catch {}

  return pruned;
}

// --- Main ---

const config = loadBackupConfig();
if (!config.enabled) {
  console.log("[backup] Disabled in config, skipping");
  process.exit(0);
}

const dateStr = new Date().toISOString().slice(0, 10);
const destDir = join(BOSUN_ROOT, config.destination);
const archivePath = join(destDir, `backup-${dateStr}.tar.gz`);

if (existsSync(archivePath)) {
  console.log(`[backup] Already exists for ${dateStr}, skipping`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

const paths = resolveBackupPaths(config.targets);
if (paths.length === 0) {
  console.log("[backup] No paths resolved, skipping");
  process.exit(0);
}

console.log(`[backup] Backing up ${paths.length} paths to ${archivePath}`);

const listFile = join(destDir, ".backup-paths.tmp");
try {
  writeFileSync(listFile, paths.join("\n"));
  const tmpArchive = archivePath + ".tmp";
  execSync(`tar czf "${tmpArchive}" --ignore-failed-read -T "${listFile}" 2>/dev/null || true`, {
    cwd: BOSUN_ROOT,
    timeout: 120000,
  });

  const { renameSync } = require("fs");
  renameSync(tmpArchive, archivePath);

  const size = statSync(archivePath).size;
  console.log(`[backup] Complete: backup-${dateStr}.tar.gz (${(size / 1024).toFixed(0)}KB, ${paths.length} paths)`);
} finally {
  try { unlinkSync(listFile); } catch {}
  try { unlinkSync(archivePath + ".tmp"); } catch {}
}

const pruned = pruneBackups(destDir, config.retention_days, config.max_backups);
if (pruned > 0) console.log(`[backup] Pruned ${pruned} old backup(s)`);
