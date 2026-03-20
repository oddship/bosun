import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec, execJson } from "./utils/exec.js";
import { logger } from "./utils/logger.js";
import { fetchGitlabMrInfo } from "./gitlab.js";
import type { MrMetadata, Platform } from "./types.js";

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface WorkspaceResult {
  workspace: string;
  targetBranch: string;
  diffBaseSha: string | null;
  isTemporary: boolean;
}

// ---------------------------------------------------------------------------
// CI detection
// ---------------------------------------------------------------------------

interface CiWorkspace {
  path: string | null;
  targetBranch: string | null;
  diffBaseSha: string | null;
}

function detectCiWorkspace(owner: string, repo: string): CiWorkspace {
  // GitLab CI
  if (process.env.GITLAB_CI === "true") {
    const projectDir = process.env.CI_PROJECT_DIR;
    const projectPath = process.env.CI_PROJECT_PATH;
    const targetBranch = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ?? null;
    const diffBaseSha = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA ?? null;

    if (projectDir && projectPath) {
      const expected = `${owner}/${repo}`;
      if (projectPath === expected || projectPath.endsWith(`/${expected}`)) {
        logger.info(`Detected GitLab CI environment (target: ${targetBranch ?? "unknown"})`);
        return { path: projectDir, targetBranch, diffBaseSha };
      }
    }
  }

  // GitHub Actions
  if (process.env.GITHUB_ACTIONS === "true") {
    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const repository = process.env.GITHUB_REPOSITORY;
    const baseRef = process.env.GITHUB_BASE_REF ?? null;

    if (workspaceDir && repository) {
      const expected = `${owner}/${repo}`;
      if (repository === expected) {
        logger.info(`Detected GitHub Actions environment (base: ${baseRef ?? "unknown"})`);
        return { path: workspaceDir, targetBranch: baseRef, diffBaseSha: null };
      }
    }
  }

  return { path: null, targetBranch: null, diffBaseSha: null };
}

// ---------------------------------------------------------------------------
// Repo identity check
// ---------------------------------------------------------------------------

/**
 * Check if workspace is already cloned from the expected owner/repo.
 * Parses the remote URL to compare exact owner/repo, avoiding substring false positives.
 */
async function isSameRepo(
  workspace: string,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    const { stdout } = await exec("git", ["remote", "get-url", "origin"], { cwd: workspace });
    const remoteUrl = stdout.trim();
    // Normalize: extract path from HTTPS or SSH URLs
    // HTTPS: https://host/owner/repo.git  SSH: git@host:owner/repo.git
    const match = remoteUrl.match(/[/:]([\w.\-\/]+?)(?:\.git)?$/) ;
    if (!match) return false;
    const remotePath = match[1];
    const expectedPath = `${owner}/${repo}`;
    return remotePath === expectedPath;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

async function getGithubBaseBranch(workspace: string, prNumber: string): Promise<string> {
  try {
    const prInfo = await execJson<Record<string, string>>(
      "gh",
      ["pr", "view", prNumber, "--json", "headRefName,baseRefName"],
      { cwd: workspace },
    );
    const baseBranch = prInfo.baseRefName ?? "main";
    logger.info(`Base branch: ${baseBranch}`);
    return baseBranch;
  } catch {
    logger.warn("Could not fetch PR metadata for base branch detection");
    return "main";
  }
}

async function fetchAndCheckoutGithubPr(
  workspace: string,
  prNumber: string,
): Promise<string> {
  logger.info(`Fetching and checking out PR #${prNumber} in existing workspace`);
  await exec("git", ["fetch", "origin"], { cwd: workspace });

  try {
    await exec("gh", ["pr", "checkout", prNumber], { cwd: workspace });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorkspaceError(`Failed to checkout PR #${prNumber}: ${msg}`);
  }

  return getGithubBaseBranch(workspace, prNumber);
}

async function cloneAndCheckoutGithubPr(
  workspace: string,
  owner: string,
  repo: string,
  prNumber: string,
): Promise<string> {
  logger.info(`Setting up GitHub workspace for ${owner}/${repo}/pull/${prNumber}`);

  try {
    await exec("gh", ["version"]);
  } catch {
    throw new WorkspaceError("GitHub CLI (gh) is not available. Install it: https://cli.github.com");
  }

  logger.info(`Cloning repository ${owner}/${repo}...`);
  try {
    await exec("gh", ["repo", "clone", `${owner}/${repo}`, workspace]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorkspaceError(`Failed to clone repository ${owner}/${repo}: ${msg}`);
  }

  logger.info(`Checking out PR #${prNumber}...`);
  try {
    await exec("gh", ["pr", "checkout", prNumber], { cwd: workspace });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorkspaceError(`Failed to checkout PR #${prNumber}: ${msg}`);
  }

  return getGithubBaseBranch(workspace, prNumber);
}

// ---------------------------------------------------------------------------
// GitLab helpers
// ---------------------------------------------------------------------------

async function getGitlabMrBranches(
  owner: string,
  repo: string,
  prNumber: string,
  host?: string,
): Promise<{ sourceBranch: string; targetBranch: string }> {
  const gitlabHost = host || process.env.GITLAB_HOST || "gitlab.com";
  let mrInfo: MrMetadata;
  try {
    mrInfo = await fetchGitlabMrInfo(owner, repo, Number(prNumber), gitlabHost);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorkspaceError(`Failed to fetch MR info for !${prNumber}: ${msg}`);
  }

  const sourceBranch = mrInfo.source_branch;
  if (!sourceBranch) {
    throw new WorkspaceError(`Could not determine source branch for MR !${prNumber}`);
  }

  return { sourceBranch, targetBranch: mrInfo.target_branch ?? "main" };
}

async function checkoutGitlabBranch(workspace: string, sourceBranch: string): Promise<void> {
  try {
    await exec("git", ["checkout", "-b", sourceBranch, `origin/${sourceBranch}`], {
      cwd: workspace,
    });
  } catch {
    try {
      await exec("git", ["checkout", sourceBranch], { cwd: workspace });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new WorkspaceError(`Failed to checkout MR branch '${sourceBranch}': ${msg}`);
    }
  }
}

async function fetchAndCheckoutGitlabMr(
  workspace: string,
  owner: string,
  repo: string,
  prNumber: string,
  host?: string,
): Promise<string> {
  logger.info(`Fetching and checking out MR !${prNumber} in existing workspace`);
  await exec("git", ["fetch", "origin"], { cwd: workspace });

  const { sourceBranch, targetBranch } = await getGitlabMrBranches(owner, repo, prNumber, host);
  logger.info(`Source branch: ${sourceBranch}, Target branch: ${targetBranch}`);
  await checkoutGitlabBranch(workspace, sourceBranch);

  return targetBranch;
}

async function cloneAndCheckoutGitlabMr(
  workspace: string,
  owner: string,
  repo: string,
  prNumber: string,
  host?: string,
): Promise<string> {
  const gitlabHost = host || process.env.GITLAB_HOST || "gitlab.com";
  logger.info(`Setting up GitLab workspace for ${owner}/${repo}/merge_requests/${prNumber}`);

  try {
    await exec("glab", ["version"]);
  } catch {
    throw new WorkspaceError(
      "GitLab CLI (glab) is not available. Install it: https://gitlab.com/gitlab-org/cli",
    );
  }

  const cloneUrl = `https://${gitlabHost}/${owner}/${repo}.git`;
  logger.info(`Cloning from ${cloneUrl}...`);
  try {
    await exec("git", ["clone", cloneUrl, workspace]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Permission denied") || msg.includes("publickey")) {
      throw new WorkspaceError(
        `Failed to clone ${owner}/${repo}: SSH authentication failed. ` +
        `Ensure your SSH key is available (ssh-add) or configure a GITLAB_TOKEN ` +
        `and use HTTPS: git config --global url."https://oauth2:$GITLAB_TOKEN@${gitlabHost}/".insteadOf "git@${gitlabHost}:"`,
      );
    }
    throw new WorkspaceError(`Failed to clone ${owner}/${repo}: ${msg}`);
  }

  const { sourceBranch, targetBranch } = await getGitlabMrBranches(owner, repo, prNumber, host);
  logger.info(`Source branch: ${sourceBranch}, Target branch: ${targetBranch}`);
  await checkoutGitlabBranch(workspace, sourceBranch);

  return targetBranch;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function setupWorkspace(opts: {
  platform: Platform;
  owner: string;
  repo: string;
  prNumber: string;
  host?: string;
  workingDir?: string;
  reuse?: boolean;
}): Promise<WorkspaceResult> {
  const { platform, owner, repo, prNumber, host, workingDir, reuse = true } = opts;

  try {
    const ci = detectCiWorkspace(owner, repo);
    let detectedTargetBranch = ci.targetBranch;
    const detectedDiffBaseSha = ci.diffBaseSha;

    let workspace: string;
    let isTemporary = false;

    if (ci.path) {
      workspace = ci.path;
    } else if (!workingDir) {
      workspace = await mkdtemp(join(tmpdir(), "hodor-review-"));
      isTemporary = true;
      logger.info(`Created temporary workspace: ${workspace}`);
    } else {
      workspace = workingDir;
      const { mkdir } = await import("node:fs/promises");
      await mkdir(workspace, { recursive: true });

      if (reuse && (await isSameRepo(workspace, owner, repo))) {
        logger.info(`Reusing existing workspace: ${workspace}`);
        // Repo already cloned — just fetch and checkout the PR/MR branch
        if (platform === "github") {
          const tb = await fetchAndCheckoutGithubPr(workspace, prNumber);
          if (!detectedTargetBranch) detectedTargetBranch = tb;
        } else if (platform === "gitlab") {
          const tb = await fetchAndCheckoutGitlabMr(workspace, owner, repo, prNumber, host);
          if (!detectedTargetBranch) detectedTargetBranch = tb;
        }
        const finalTargetBranch = detectedTargetBranch ?? "main";
        logger.info(
          `Workspace ready at: ${workspace} (target: ${finalTargetBranch}, ` +
          `diff_base_sha: ${detectedDiffBaseSha?.slice(0, 8) ?? "N/A"})`,
        );
        return { workspace, targetBranch: finalTargetBranch, diffBaseSha: detectedDiffBaseSha, isTemporary: false };
      }
    }

    if (!ci.path) {
      if (platform === "github") {
        const tb = await cloneAndCheckoutGithubPr(workspace, owner, repo, prNumber);
        if (!detectedTargetBranch) detectedTargetBranch = tb;
      } else if (platform === "gitlab") {
        const tb = await cloneAndCheckoutGitlabMr(workspace, owner, repo, prNumber, host);
        if (!detectedTargetBranch) detectedTargetBranch = tb;
      } else {
        throw new WorkspaceError(`Unsupported platform: ${platform}`);
      }
    }

    const finalTargetBranch = detectedTargetBranch ?? "main";
    logger.info(
      `Workspace ready at: ${workspace} (target: ${finalTargetBranch}, ` +
      `diff_base_sha: ${detectedDiffBaseSha?.slice(0, 8) ?? "N/A"})`,
    );
    return { workspace, targetBranch: finalTargetBranch, diffBaseSha: detectedDiffBaseSha, isTemporary };
  } catch (err) {
    if (err instanceof WorkspaceError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorkspaceError(`Failed to setup workspace: ${msg}`);
  }
}

export async function cleanupWorkspace(workspace: string): Promise<void> {
  try {
    await rm(workspace, { recursive: true, force: true });
    logger.info(`Cleaned up workspace: ${workspace}`);
  } catch (err) {
    logger.warn(`Failed to cleanup workspace ${workspace}: ${err}`);
  }
}
