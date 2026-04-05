import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { worktreeRoot } from "./harness";

export interface MemoryFixtureRoot {
  root: string;
  home: string;
  cleanup(): void;
}

export function createMemoryFixtureRoot(name: string): MemoryFixtureRoot {
  const sourceRoot = worktreeRoot();
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  const home = join(root, ".bosun-home");

  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, "workspace", "users", "demo", "plans"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, ".pi", "skills"), { recursive: true });
  mkdirSync(join(root, ".pi", "agents"), { recursive: true });

  for (const entry of ["package.json", "bun.lock", "justfile", "packages", "scripts", "config", "node_modules"]) {
    symlinkSync(join(sourceRoot, entry), join(root, entry));
  }

  writeFileSync(
    join(root, "config.toml"),
    `# E2E config\n\n[models]\nlite = "gpt-5.4-mini"\nmedium = "gpt-5.3-codex"\nhigh = "gpt-5.4"\noracle = "gpt-5.4"\n\n[workspace]\npath = "workspace"\n\n[agents]\ndefault_agent = "bosun"\n\n[backend]\ntype = "tmux"\ncommand_prefix = "scripts/sandbox.sh"\n\n[env]\nallowed = ["USER", "LOGNAME", "TERM", "LANG", "TZ"]\n\n[paths]\nro_bind = []\nrw_bind = []\n\n[sandbox]\nenabled = true\n\n[sandbox.filesystem]\ndeny_read = ["~/.ssh", "~/.aws", "~/.gnupg"]\nallow_write = [".", "/tmp"]\ndeny_write = [".env", ".env.*", "*.pem", "*.key"]\n\n[daemon]\nenabled = false\nheartbeat_interval_seconds = 30\nlog_level = "info"\n\n[mesh]\nauto_register = true\ncontext_mode = "full"\nfeed_retention = 50\nauto_status = true\n\n[mesh.identity_sync]\nenabled = true\nstartup_align = true\nmesh_to_tmux = true\ntmux_to_mesh = true\npoll_interval_ms = 2000\n\n[memory]\nenabled = true\ndb_path = ".bosun-home/.cache/qmd/index.sqlite"\nauto_update_on_open = true\ndefault_mode = "keyword"\ndefault_limit = 5\n\n[memory.search_defaults]\nmin_score = 0.0\nrerank = true\n\n[memory.formatting]\nsnippet_max_lines = 12\nmulti_get_max_bytes = 20480\ndefault_get_max_lines = 80\n\n[memory.collections.sessions]\npath = "workspace/users"\npattern = "**/*.md"\ninclude_by_default = true\n\n[memory.collections.docs]\npath = "docs"\npattern = "**/*.md"\ninclude_by_default = true\n\n[memory.collections.skills]\npath = ".pi/skills"\npattern = "**/*.md"\ninclude_by_default = false\n\n[memory.collections.agents]\npath = ".pi/agents"\npattern = "**/*.md"\ninclude_by_default = false\n\n[keybindings]\ncursorLineStart = ["home"]\n\n[q]\ndata_dir = "workspace/users"\n`,
  );

  writeFileSync(
    join(root, "workspace", "users", "demo", "plans", "memory-plan.md"),
    `---\ntitle: Memory Plan\n---\n\n# Memory Plan\n\nWe decided to build a bosun-native memory package backed by qmd v2 and avoid MCP.\n`,
  );
  writeFileSync(
    join(root, "docs", "memory-architecture.md"),
    `# Memory Architecture\n\npi-memory uses qmd as a library and exposes a single memory tool with search, get, multi_get, and status actions.\n`,
  );
  writeFileSync(
    join(root, ".pi", "skills", "example.md"),
    `# Example Skill\n\nThis skill mentions memory retrieval and search strategy.\n`,
  );
  writeFileSync(
    join(root, ".pi", "agents", "example.md"),
    `---\nname: example\n---\n\n# Example Agent\n`,
  );

  return {
    root,
    home,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function runInFixture(root: string, home: string, command: string): Promise<string> {
  try {
    const result = await $`bash -c ${command}`.cwd(root).env({ ...process.env, HOME: home }).quiet();
    return result.text().trim();
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      throw new Error(`${error.message}\n${String((error as { stderr?: string }).stderr || "")}`.trim());
    }
    throw error;
  }
}

export async function runInit(root: string, home: string): Promise<void> {
  await runInFixture(root, home, "bun scripts/init.ts >/dev/null");
}

export async function readJson<T>(root: string, relativePath: string): Promise<T> {
  const file = Bun.file(join(root, relativePath));
  return await file.json() as T;
}
