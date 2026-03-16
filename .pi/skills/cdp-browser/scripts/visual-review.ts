#!/usr/bin/env bun
/**
 * Visual review — reusable bosun capability.
 *
 * Crawls a local site at multiple viewports, takes screenshots,
 * and checks for common UX issues. Works on any project.
 *
 * Usage:
 *   bun .pi/skills/cdp-browser/scripts/visual-review.ts \
 *     --base http://localhost:8080 \
 *     --pages / /about/ /docs/ \
 *     --out workspace/scratch/review
 *
 * Or auto-discover pages from a sitemap / directory listing:
 *   bun .pi/skills/cdp-browser/scripts/visual-review.ts \
 *     --base http://localhost:8080 \
 *     --crawl
 */

import { run, type Browser } from "./cdp-client";

// ---------------------------------------------------------------------------
// Config from CLI args
// ---------------------------------------------------------------------------

const BASE_URL = getArg("--base") ?? "http://localhost:8080";
const OUT_DIR = getArg("--out") ?? "workspace/scratch/visual-review";
const shouldCrawl = process.argv.includes("--crawl");
const jsonReport = process.argv.includes("--json");

let pages = getArgList("--pages");

const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Issue {
  page: string;
  viewport: string;
  type: "overflow" | "inline-style" | "console-error" | "a11y" | "missing-element";
  detail: string;
}

// ---------------------------------------------------------------------------
// Crawl: discover pages by following internal links
// ---------------------------------------------------------------------------

async function crawlPages(b: Browser, base: string): Promise<string[]> {
  await b.navigate(base);
  const hrefs = await b.eval<string[]>(`
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.getAttribute('href'))
      .filter(h => h && (h.startsWith('/') || h.startsWith('${base}')))
      .map(h => h.startsWith('/') ? h : new URL(h).pathname)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort()
  `);
  // Always include root
  const all = ["/", ...hrefs.filter((h) => h !== "/")];
  return all;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkOverflow(b: Browser, page: string, vp: string): Promise<Issue[]> {
  const overflows = await b.checkOverflow();
  return overflows.map((o) => ({
    page,
    viewport: vp,
    type: "overflow" as const,
    detail: `${o.selector} → ${o.overflow}px`,
  }));
}

async function checkInlineStyles(b: Browser, page: string, vp: string): Promise<Issue[]> {
  const styles = await b.findInlineStyles();
  // html[style="color-scheme: ..."] is expected from theme toggles
  const unexpected = styles.filter(
    (s) => !(s.selector === "html" && s.style.includes("color-scheme"))
  );
  return unexpected.map((s) => ({
    page,
    viewport: vp,
    type: "inline-style" as const,
    detail: `${s.selector}: style="${s.style}"`,
  }));
}

async function checkA11y(b: Browser, page: string, vp: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const checks: [string, string][] = [
    ["nav, [role='navigation']", "navigation landmark"],
    ["main", "main landmark"],
    ["h1", "h1 heading"],
  ];
  for (const [selector, label] of checks) {
    if (!(await b.exists(selector))) {
      issues.push({ page, viewport: vp, type: "a11y", detail: `Missing ${label}` });
    }
  }
  const imgsNoAlt = await b.eval<number>(
    `document.querySelectorAll('img:not([alt])').length`
  );
  if (imgsNoAlt > 0) {
    issues.push({ page, viewport: vp, type: "a11y", detail: `${imgsNoAlt} image(s) without alt` });
  }
  return issues;
}

async function checkConsoleErrors(b: Browser, page: string): Promise<Issue[]> {
  const errs = await b.errors(1500);
  return errs.map((e) => ({
    page,
    viewport: "all",
    type: "console-error" as const,
    detail: e.text.slice(0, 200),
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

await run(async (b) => {
  // Discover pages if needed
  if (shouldCrawl || pages.length === 0) {
    if (!shouldCrawl && pages.length === 0) {
      console.error("No --pages given. Use --crawl to auto-discover, or pass --pages / /about/ ...");
      process.exit(1);
    }
    process.stderr.write("Crawling for pages... ");
    pages = await crawlPages(b, BASE_URL);
    process.stderr.write(`found ${pages.length}\n`);
  }

  const allIssues: Issue[] = [];
  const startTime = Date.now();
  const vpNames = Object.keys(VIEWPORTS);

  if (!jsonReport) {
    console.log(`\n🔍 Visual review: ${pages.length} pages × ${vpNames.length} viewports`);
    console.log(`   Base: ${BASE_URL}`);
    console.log(`   Screenshots: ${OUT_DIR}/\n`);
  }

  Bun.spawnSync(["mkdir", "-p", OUT_DIR]);

  for (const page of pages) {
    const slug = page === "/" ? "home" : page.replace(/^\/|\/$/g, "").replace(/\//g, "-");

    if (!jsonReport) process.stdout.write(`  ${page.padEnd(40)}`);

    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      // Set viewport BEFORE navigating so CSS media queries apply from the start.
      // This avoids false positives from CSS transitions when resizing after load.
      await b.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 768,
      });
      await b.navigate(BASE_URL + page);
      await b.sleep(200);

      await b.screenshot(`${OUT_DIR}/${slug}-${vpName}.png`);

      // Console errors (check at each viewport — JS may differ)
      if (vpName === "desktop") {
        allIssues.push(...(await checkConsoleErrors(b, page)));
        allIssues.push(...(await checkA11y(b, page, vpName)));
      }

      allIssues.push(...(await checkOverflow(b, page, vpName)));
      allIssues.push(...(await checkInlineStyles(b, page, vpName)));
    }

    await b.send("Emulation.clearDeviceMetricsOverride", {});
    if (!jsonReport) console.log("✓");
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const screenshotCount = pages.length * vpNames.length;

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------

  if (jsonReport) {
    console.log(JSON.stringify({
      base: BASE_URL,
      pages: pages.length,
      viewports: vpNames,
      screenshots: screenshotCount,
      screenshotDir: OUT_DIR,
      elapsedSeconds: Number(elapsed),
      issues: allIssues,
      issueCount: allIssues.length,
    }, null, 2));
    process.exit(allIssues.length > 0 ? 1 : 0);
  }

  console.log(`\n📸 ${screenshotCount} screenshots → ${OUT_DIR}/`);
  console.log(`⏱  ${elapsed}s\n`);

  if (allIssues.length === 0) {
    console.log("✅ No issues found.\n");
    return;
  }

  // Group by type, deduplicate
  const byType = new Map<string, Issue[]>();
  for (const issue of allIssues) {
    const list = byType.get(issue.type) ?? [];
    list.push(issue);
    byType.set(issue.type, list);
  }

  const labels: Record<string, string> = {
    overflow: "Horizontal Overflow",
    "inline-style": "Inline Styles",
    "console-error": "Console Errors",
    a11y: "Accessibility",
    "missing-element": "Missing Elements",
  };

  console.log(`⚠  ${allIssues.length} issue(s):\n`);
  for (const [type, issues] of byType) {
    console.log(`  ${labels[type] ?? type} (${issues.length}):`);
    const seen = new Set<string>();
    for (const issue of issues) {
      const key = `${issue.page}|${issue.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`    ${issue.page} @ ${issue.viewport}: ${issue.detail}`);
    }
    console.log();
  }

  process.exit(1);
});

// ---------------------------------------------------------------------------
// Arg helpers
// ---------------------------------------------------------------------------

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

function getArgList(flag: string): string[] {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return [];
  const items: string[] = [];
  for (let i = idx + 1; i < process.argv.length; i++) {
    if (process.argv[i].startsWith("--")) break;
    items.push(process.argv[i]);
  }
  return items;
}
