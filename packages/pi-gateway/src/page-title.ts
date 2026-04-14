function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstMarkdownH1(markdown: string): string | undefined {
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      const heading = stripInlineMarkdown(line.slice(2));
      return heading || undefined;
    }
  }
  return undefined;
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function titleFromRelativeMarkdownPath(relativePath: string | undefined): string | undefined {
  if (!relativePath) return undefined;
  const normalized = relativePath.replace(/\\/g, "/");
  const withoutExt = normalized.endsWith(".md") ? normalized.slice(0, -3) : normalized;

  if (withoutExt.endsWith("/index")) {
    const parent = withoutExt.slice(0, -"/index".length).split("/").filter(Boolean).at(-1);
    const titled = parent ? titleCaseSlug(parent) : undefined;
    return titled || undefined;
  }

  const stem = withoutExt.split("/").filter(Boolean).at(-1);
  if (!stem || stem === "index") return undefined;
  const titled = titleCaseSlug(stem);
  return titled || undefined;
}

export function resolveMarkdownPageTitle(options: {
  frontmatterTitle?: string;
  markdownContent: string;
  fallbackTitle: string;
  relativePath?: string;
}): string {
  const frontmatterTitle = options.frontmatterTitle?.trim();
  if (frontmatterTitle) return frontmatterTitle;

  const h1Title = firstMarkdownH1(options.markdownContent);
  if (h1Title) return h1Title;

  const pathTitle = titleFromRelativeMarkdownPath(options.relativePath);
  if (pathTitle) return pathTitle;

  return options.fallbackTitle;
}
