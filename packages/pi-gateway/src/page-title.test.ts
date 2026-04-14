import { describe, expect, test } from "bun:test";
import { firstMarkdownH1, resolveMarkdownPageTitle, titleFromRelativeMarkdownPath } from "./page-title";

describe("page title resolution", () => {
  test("prefers frontmatter title", () => {
    const title = resolveMarkdownPageTitle({
      frontmatterTitle: "Steward Inbox",
      markdownContent: "# Inbox\n\nHello",
      fallbackTitle: "pi-steward/control",
      relativePath: "inbox.md",
    });

    expect(title).toBe("Steward Inbox");
  });

  test("falls back to first markdown h1", () => {
    const title = resolveMarkdownPageTitle({
      markdownContent: "\n# **Household** [Overview](household.md)\n\nBody",
      fallbackTitle: "pi-steward/control",
      relativePath: "household.md",
    });

    expect(title).toBe("Household Overview");
  });

  test("derives title from path when markdown has no h1", () => {
    expect(titleFromRelativeMarkdownPath("pages/daily-brief.md")).toBe("Daily Brief");
    expect(titleFromRelativeMarkdownPath("pages/journal/index.md")).toBe("Journal");
  });

  test("uses fallback when no frontmatter, h1, or path title is available", () => {
    const title = resolveMarkdownPageTitle({
      markdownContent: "No heading here",
      fallbackTitle: "pi-steward/control",
      relativePath: "index.md",
    });

    expect(title).toBe("pi-steward/control");
  });

  test("extracts first h1 only", () => {
    expect(firstMarkdownH1("# One\n\n## Two\n# Three")).toBe("One");
  });
});
