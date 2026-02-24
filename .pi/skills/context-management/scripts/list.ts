#!/usr/bin/env bun
/**
 * List context management documents (handoffs, forks, plans)
 *
 * Usage:
 *   bun list.ts              # Actionable only (pending + picked_up)
 *   bun list.ts all          # Everything
 *   bun list.ts completed    # Only completed/superseded
 *   bun list.ts pending      # Only pending
 *   bun list.ts handoffs     # Only handoffs (actionable)
 *   bun list.ts forks        # Only forks (actionable)
 *   bun list.ts plans        # Only plans
 *   bun list.ts --since=7d   # Last 7 days only
 *   bun list.ts all --since=30d  # Combine filters
 *
 * Environment:
 *   DEBUG=1 bun list.ts      # Enable debug logging
 *
 * TODO: Layer 2 - Archive Command
 *   When completed items accumulate, create an archive script:
 *   - bun scripts/archive.ts  # Move completed >30d to archive/ subfolder
 *   - Structure: handoffs/archive/2026-01/*.md
 *   - This script already skips archive/ folders by default
 *   - Retention policy: handoffs 90d, forks 30d, plans never
 */
import { readdir, readFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

// =============================================================================
// Constants
// =============================================================================

const DEBUG = process.env.DEBUG === "1";
const MAX_RESULTS = 50;

// Resolve paths relative to repo root (script is at .pi/skills/context-management/scripts/)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const USER = process.env.USER || process.env.LOGNAME || "unknown";
const BASE = resolve(REPO_ROOT, `workspace/users/${USER}`);

// Status classifications
const ACTIONABLE_STATUSES = ["pending", "picked_up", "in_progress", "active"];
const ARCHIVED_STATUSES = ["completed", "superseded", "cancelled", "done"];

// Filter configuration: which directories to scan for each filter
const FILTER_TO_DIRS: Record<string, DocType[]> = {
  all: ["plan", "handoff", "fork"],
  actionable: ["plan", "handoff", "fork"],
  completed: ["plan", "handoff", "fork"],
  pending: ["handoff", "fork"], // Plans don't have "pending" status
  handoffs: ["handoff"],
  forks: ["fork"],
  plans: ["plan"],
};

// Time unit multipliers for --since parsing
const TIME_MULTIPLIERS: Record<string, number> = {
  h: 60 * 60 * 1000, // hours
  d: 24 * 60 * 60 * 1000, // days
  w: 7 * 24 * 60 * 60 * 1000, // weeks
};

// =============================================================================
// Types
// =============================================================================

type DocType = "plan" | "handoff" | "fork";

interface ContextDoc {
  path: string;
  type: DocType;
  title: string;
  status: string;
  created: string;
}

interface ListResult {
  docs: ContextDoc[];
  summary: {
    showing: number;
    hidden: {
      completed: number;
      superseded: number;
      total: number;
    };
    byType: {
      handoffs: number;
      forks: number;
      plans: number;
    };
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function debug(msg: string, ...args: unknown[]): void {
  if (DEBUG) console.error(`[DEBUG] ${msg}`, ...args);
}

/**
 * Recursively finds all .md files in a directory
 * @param dir - Directory to search
 * @param skipArchive - Whether to skip 'archive' subdirectories (default: true)
 * @returns Array of absolute file paths
 */
async function findMdFiles(dir: string, skipArchive = true): Promise<string[]> {
  const results: string[] = [];

  async function walkDir(d: string): Promise<void> {
    try {
      const entries = await readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(d, entry.name);
        if (entry.isDirectory()) {
          if (skipArchive && entry.name === "archive") {
            debug(`Skipping archive directory: ${fullPath}`);
            continue;
          }
          await walkDir(fullPath);
        } else if (
          entry.isFile() &&
          entry.name.endsWith(".md") &&
          !entry.name.startsWith("_")
        ) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      debug(`Failed to read directory ${d}:`, error);
    }
  }

  await walkDir(dir);
  return results;
}

/**
 * Extracts metadata from a markdown file's frontmatter
 * @param filePath - Absolute path to the file
 * @param type - Document type (plan, handoff, fork)
 * @returns Parsed document metadata or null on error
 */
async function extractMetadata(
  filePath: string,
  type: DocType
): Promise<ContextDoc | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const { data } = matter(content);

    // Use relative path from repo root for cleaner output
    const relativePath = filePath.startsWith(REPO_ROOT)
      ? filePath.slice(REPO_ROOT.length + 1)
      : filePath;

    return {
      path: relativePath,
      type,
      title:
        data.title ||
        filePath.split("/").pop()?.replace(".md", "") ||
        "Untitled",
      status: data.status || (type === "plan" ? "active" : "unknown"),
      created: data.created || data.created_at || "",
    };
  } catch (error) {
    debug(`Failed to read file ${filePath}:`, error);
    return null;
  }
}

/**
 * Parses the --since=Nd argument to get a timestamp threshold
 * @param args - Command line arguments
 * @returns Timestamp (ms since epoch) or null if not specified/invalid
 */
function parseSinceArg(args: string[]): number | null {
  const sinceArg = args.find((a) => a.startsWith("--since="));
  if (!sinceArg) return null;

  const value = sinceArg.replace("--since=", "");
  const match = value.match(/^(\d+)([dhw])$/);
  if (!match) {
    debug(`Invalid --since format: ${value}. Expected: Nd, Nh, or Nw`);
    return null;
  }

  const num = parseInt(match[1], 10);
  const unit = match[2];

  if (isNaN(num) || num <= 0) {
    debug(`Invalid --since number: ${num}`);
    return null;
  }

  const multiplier = TIME_MULTIPLIERS[unit];
  if (!multiplier) {
    debug(`Unknown time unit: ${unit}`);
    return null;
  }

  return Date.now() - num * multiplier;
}

/**
 * Determines if a document should be included based on the filter
 * @param doc - Document to check
 * @param filter - Active filter name
 * @returns Whether to include the document
 */
function shouldIncludeDoc(doc: ContextDoc, filter: string): boolean {
  // Type filtering
  if (filter === "handoffs" && doc.type !== "handoff") return false;
  if (filter === "forks" && doc.type !== "fork") return false;
  if (filter === "plans" && doc.type !== "plan") return false;

  // Status filtering
  if (filter === "pending") {
    return doc.status === "pending";
  }
  if (filter === "completed") {
    return ARCHIVED_STATUSES.includes(doc.status);
  }
  if (filter === "all") {
    return true;
  }
  // Default (actionable) and type-specific filters: show only actionable statuses
  return ACTIONABLE_STATUSES.includes(doc.status);
}

/**
 * Gets the directory path for a document type
 */
function getDirForType(type: DocType): string {
  const typeToDir: Record<DocType, string> = {
    plan: "plans",
    handoff: "handoffs",
    fork: "forks",
  };
  return join(BASE, typeToDir[type]);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filter = args.find((a) => !a.startsWith("--")) || "actionable";
  const sinceTimestamp = parseSinceArg(args);

  debug(`Filter: ${filter}, Since: ${sinceTimestamp}, Base: ${BASE}`);

  // Determine which directories to scan based on filter
  const typesToScan = FILTER_TO_DIRS[filter] || FILTER_TO_DIRS.actionable;
  const includeArchive = filter === "all" || filter === "completed";

  debug(`Types to scan: ${typesToScan.join(", ")}, Include archive: ${includeArchive}`);

  // Collect all documents
  const allFiles = await Promise.all(
    typesToScan.map(async (type) => {
      const dir = getDirForType(type);
      const files = await findMdFiles(dir, !includeArchive);
      debug(`Found ${files.length} files in ${dir}`);
      return Promise.all(files.map((f) => extractMetadata(f, type)));
    })
  );

  const allDocs = allFiles.flat().filter((d): d is ContextDoc => d !== null);
  debug(`Total documents found: ${allDocs.length}`);

  // Count totals before filtering (for summary)
  const totalByStatus = {
    completed: allDocs.filter((d) => d.status === "completed").length,
    superseded: allDocs.filter((d) => d.status === "superseded").length,
    cancelled: allDocs.filter((d) => d.status === "cancelled").length,
  };

  // Apply filters
  let docs = allDocs.filter((doc) => shouldIncludeDoc(doc, filter));

  // Apply time filter
  if (sinceTimestamp) {
    docs = docs.filter((d) => {
      if (!d.created) return true; // Keep docs without dates
      const docTime = new Date(d.created).getTime();
      return docTime >= sinceTimestamp;
    });
  }

  // Sort by created date, newest first
  docs.sort((a, b) => {
    const dateA = new Date(a.created || 0).getTime();
    const dateB = new Date(b.created || 0).getTime();
    return dateB - dateA;
  });

  // Calculate hidden count (only relevant when we're hiding items)
  const hiddenTotal =
    totalByStatus.completed + totalByStatus.superseded + totalByStatus.cancelled;
  const isHidingItems =
    filter === "actionable" || ["handoffs", "forks", "plans"].includes(filter);

  // Build result
  const result: ListResult = {
    docs: docs.slice(0, MAX_RESULTS),
    summary: {
      showing: Math.min(docs.length, MAX_RESULTS),
      hidden: {
        completed: totalByStatus.completed,
        superseded: totalByStatus.superseded,
        total: isHidingItems ? hiddenTotal : 0,
      },
      byType: {
        handoffs: docs.filter((d) => d.type === "handoff").length,
        forks: docs.filter((d) => d.type === "fork").length,
        plans: docs.filter((d) => d.type === "plan").length,
      },
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
