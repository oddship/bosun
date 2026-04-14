const state = {
  summary: null,
  viewModel: null,
  markdown: "",
  markdownLines: [],
  selectedId: null,
  drafts: [],
  threads: [],
  recentEvents: [],
  globalComment: "",
  globalAnchor: null,
  summaryText: "",
  reroundSummaryText: "",
  composerComment: "",
  composerSuggestion: "",
  mode: "full",
  pendingFocusComposer: false,
  pendingScrollId: null,
};

let draftSaveTimer = null;

const els = {
  title: document.getElementById("title"),
  subtitle: document.getElementById("subtitle"),
  meta: document.getElementById("meta"),
  navigatorPane: document.getElementById("navigator-pane"),
  documentHero: document.getElementById("document-hero"),
  documentPane: document.getElementById("document-pane"),
  sidebarPane: document.getElementById("sidebar-pane"),
  status: document.getElementById("status"),
  summaryInput: document.getElementById("summary-input"),
  reroundSummaryInput: document.getElementById("reround-summary-input"),
  submitApprove: document.getElementById("submit-approve"),
  submitRequestChanges: document.getElementById("submit-request-changes"),
  publishReround: document.getElementById("publish-reround"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeMarkdown(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function setStatus(message, kind = "") {
  els.status.className = `status ${kind}`.trim();
  els.status.textContent = message || "";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function selectorEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function headingLabelFromAnchor(anchor) {
  return anchor?.headingPath?.length ? anchor.headingPath.join(" / ") : "(root)";
}

function anchorKey(anchor) {
  return JSON.stringify({
    headingPath: anchor?.headingPath || [],
    blockKind: anchor?.blockKind || null,
    blockIndexPath: anchor?.blockIndexPath || [],
    quote: anchor?.quote || null,
    lineStart: anchor?.lineStart ?? null,
    lineEnd: anchor?.lineEnd ?? null,
  });
}

function currentBlock() {
  return state.viewModel?.blocks.find((block) => block.id === state.selectedId) || null;
}

function currentAnchor() {
  return state.summary?.document?.anchors.find((anchor) => anchor.id === state.selectedId) || null;
}

function matchingBlockIdForAnchor(anchor) {
  const documentAnchors = state.summary?.document?.anchors || [];
  const key = anchorKey(anchor);
  const match = documentAnchors.find((candidate) => anchorKey(candidate) === key);
  return match?.id ?? anchor?.id ?? null;
}

function hydrateDrafts(drafts) {
  return (drafts || []).map((draft) => ({
    ...draft,
    anchorId: matchingBlockIdForAnchor(draft.anchor),
    headingLabel: headingLabelFromAnchor(draft.anchor),
  }));
}

function hydrateThreads(threads) {
  return (threads || []).map((thread) => ({
    ...thread,
    anchorId: matchingBlockIdForAnchor(thread.anchor),
    headingLabel: headingLabelFromAnchor(thread.anchor),
  }));
}

function selectedDraft() {
  return state.drafts.find((draft) => draft.anchorId === state.selectedId) || null;
}

function selectedThreads() {
  return state.threads.filter((thread) => thread.anchorId === state.selectedId);
}

function syncComposerFromSelection() {
  const draft = selectedDraft();
  state.composerComment = draft?.comment || "";
  state.composerSuggestion = draft?.suggestion || "";
}

function selectBlock(anchorId, options = {}) {
  state.selectedId = anchorId;
  syncComposerFromSelection();
  state.pendingFocusComposer = Boolean(options.focusComposer);
  state.pendingScrollId = options.scroll ? anchorId : null;
  render();
}

function queueDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    void saveDraftState();
  }, 150);
}

async function saveDraftState() {
  try {
    const response = await fetch("/api/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        drafts: state.drafts.map((draft) => ({
          anchor: draft.anchor,
          comment: draft.comment,
          suggestion: draft.suggestion,
          threadId: draft.threadId || null,
        })),
        globalComment: state.globalComment,
      }),
    });

    if (!response.ok) {
      setStatus(await response.text(), "error");
      return;
    }

    const payload = await response.json();
    state.summary.draftState = payload.draftState;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function renderInlineMarkdown(value) {
  const tokens = [];
  const tokenFor = (html) => {
    const token = `@@INLINE_${tokens.length}@@`;
    tokens.push(html);
    return token;
  };

  let output = escapeHtml(value || "");
  output = output.replace(/`([^`]+)`/g, (_, code) => tokenFor(`<code>${code}</code>`));
  output = output.replace(
    /\[([^\]]+)\]\(([^)\s]+(?:\s+&quot;[^&]+&quot;)?[^)]*)\)/g,
    (_, label, href) => tokenFor(`<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`),
  );
  output = output
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return output.replace(/@@INLINE_(\d+)@@/g, (_, index) => tokens[Number(index)] || "");
}

function sourceLinesForBlock(block) {
  if (!block || block.lineStart == null || block.lineEnd == null) return [];
  return state.markdownLines.slice(Math.max(0, block.lineStart - 1), block.lineEnd);
}

function sourceForBlock(block) {
  return sourceLinesForBlock(block).join("\n");
}

function headingLevelForBlock(block) {
  const raw = sourceForBlock(block).trim();
  const match = /^(#{1,6})\s+/.exec(raw);
  if (match) return match[1].length;
  return Math.min(Math.max(block.headingPath?.length || 1, 1), 6);
}

function paragraphTextFromBlock(block) {
  const lines = sourceLinesForBlock(block).map((line) => line.trim()).filter(Boolean);
  const text = lines.join(" ").trim();
  return text || block.text || "";
}

function quoteTextFromBlock(block) {
  const lines = sourceLinesForBlock(block)
    .map((line) => line.replace(/^\s*>\s?/, "").trim())
    .filter(Boolean);
  return (lines.join(" ").trim() || block.text || "");
}

function codeTextFromBlock(block) {
  const lines = sourceLinesForBlock(block);
  if (!lines.length) return block.text || "";
  const trimmedStart = lines[0].trim();
  const trimmedEnd = lines.at(-1)?.trim() || "";
  const withoutFenceStart = /^(~~~|```)/.test(trimmedStart) ? lines.slice(1) : lines;
  const withoutFence = /^(~~~|```)/.test(trimmedEnd)
    ? withoutFenceStart.slice(0, Math.max(0, withoutFenceStart.length - 1))
    : withoutFenceStart;
  return withoutFence.join("\n");
}

function parseTableLines(block) {
  const lines = sourceLinesForBlock(block)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const rows = lines.map((line) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim()),
  );
  if (rows.length < 2) return null;
  return {
    header: rows[0],
    body: rows.slice(2),
  };
}

function parseListItem(block) {
  const lines = sourceLinesForBlock(block);
  if (!lines.length) {
    return { checked: false, text: block.text || "" };
  }

  const first = lines[0];
  let checked = false;
  let firstContent = first;

  if (block.blockKind === "checklist_item") {
    const match = /^\s*(?:[-*+]|\d+\.)\s+\[( |x|X)\]\s+(.*)$/.exec(first);
    if (match) {
      checked = match[1].toLowerCase() === "x";
      firstContent = match[2];
    } else {
      firstContent = first.replace(/^\s*(?:[-*+]|\d+\.)\s+\[(?: |x|X)\]\s+/, "");
    }
  } else {
    firstContent = first.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
  }

  const tail = lines.slice(1).map((line) => line.trim()).filter(Boolean);
  const text = [firstContent.trim(), ...tail].join(" ").trim() || block.text || "";
  return { checked, text };
}

function listKindForBlock(block) {
  if (block.blockKind === "checklist_item") return "checklist";
  const firstLine = sourceLinesForBlock(block)[0]?.trim() || "";
  return /^\d+\.\s+/.test(firstLine) ? "ordered" : "unordered";
}

function orderedListStart(block) {
  const firstLine = sourceLinesForBlock(block)[0]?.trim() || "";
  const match = /^(\d+)\.\s+/.exec(firstLine);
  return match ? Number(match[1]) : 1;
}

function sameHeadingPath(a, b) {
  if ((a?.length || 0) !== (b?.length || 0)) return false;
  return (a || []).every((part, index) => part === b[index]);
}

function lineGap(a, b) {
  if (a?.lineEnd == null || b?.lineStart == null) return Number.POSITIVE_INFINITY;
  return b.lineStart - a.lineEnd;
}

function canJoinListGroup(current, next) {
  if (!current || !next) return false;
  if (!["list_item", "checklist_item"].includes(current.blockKind)) return false;
  if (current.blockKind !== next.blockKind) return false;
  if (!sameHeadingPath(current.headingPath, next.headingPath)) return false;
  if (listKindForBlock(current) !== listKindForBlock(next)) return false;
  return lineGap(current, next) <= 2;
}

function buildDocumentNodes(blocks) {
  const nodes = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (["list_item", "checklist_item"].includes(block.blockKind)) {
      const items = [block];
      while (index + 1 < blocks.length && canJoinListGroup(items.at(-1), blocks[index + 1])) {
        items.push(blocks[index + 1]);
        index += 1;
      }
      nodes.push({
        kind: "list",
        listKind: listKindForBlock(block),
        items,
      });
      continue;
    }
    nodes.push({ kind: "block", block });
  }
  return nodes;
}

function threadsForAnchor(anchorId) {
  return state.threads.filter((thread) => thread.anchorId === anchorId);
}

function draftForAnchor(anchorId) {
  return state.drafts.find((draft) => draft.anchorId === anchorId) || null;
}

function blockClasses(block, draft, threads) {
  const classes = ["doc-anchor"];
  if (block.id === state.selectedId) classes.push("active");
  if (draft) classes.push("has-draft");
  if (threads.length) classes.push("has-thread");
  if (threads.some((thread) => thread.stale)) classes.push("has-stale-thread");
  return classes.join(" ");
}

function showDocumentChangeBadge(block) {
  return Boolean(
    state.viewModel &&
    state.viewModel.mode === "delta" &&
    state.viewModel.diffSummary.previousAnchorCount > 0 &&
    block.changeKind !== "unchanged",
  );
}

function renderAnchorFlags(block, draft, threads) {
  const flags = [];
  if (showDocumentChangeBadge(block)) {
    const changeClass = block.changeKind === "added" ? "good" : "warn";
    flags.push(`<span class="doc-flag ${changeClass}">${escapeHtml(block.changeKind)}</span>`);
  }
  if (draft) {
    flags.push('<span class="doc-flag warn">draft queued</span>');
  }
  const openCount = threads.filter((thread) => thread.status === "open").length;
  const staleCount = threads.filter((thread) => thread.stale).length;
  if (openCount > 0) {
    flags.push(`<span class="doc-flag accent">${openCount} open</span>`);
  }
  if (staleCount > 0) {
    flags.push(`<span class="doc-flag bad">${staleCount} stale</span>`);
  }
  return flags.length ? `<div class="doc-anchor-flags">${flags.join("")}</div>` : "";
}

function renderAnchorSummary(block, draft, threads) {
  const chips = [];
  if (draft) {
    chips.push(`<button class="summary-chip warn" data-draft-anchor="${escapeHtml(block.id)}">Draft queued</button>`);
  }
  if (threads.length > 0) {
    const stale = threads.some((thread) => thread.stale);
    chips.push(
      `<button class="summary-chip ${stale ? "bad" : "accent"}" data-thread-anchor="${escapeHtml(block.id)}">${threads.length} thread${threads.length === 1 ? "" : "s"}</button>`,
    );
  }
  return chips.length ? `<div class="doc-anchor-summary">${chips.join("")}</div>` : "";
}

function renderHeadingBlock(block) {
  const raw = sourceForBlock(block).trim();
  const match = /^(#{1,6})\s+(.*)$/.exec(raw);
  const level = headingLevelForBlock(block);
  const text = match?.[2]?.trim() || block.text || "";
  return `<h${level}>${renderInlineMarkdown(text)}</h${level}>`;
}

function renderParagraphBlock(block) {
  return `<p>${renderInlineMarkdown(paragraphTextFromBlock(block))}</p>`;
}

function renderQuoteBlock(block) {
  return `<blockquote><p>${renderInlineMarkdown(quoteTextFromBlock(block))}</p></blockquote>`;
}

function renderCodeBlock(block) {
  return `<pre><code>${escapeHtml(codeTextFromBlock(block))}</code></pre>`;
}

function renderTableBlock(block) {
  const table = parseTableLines(block);
  if (!table) {
    return `<pre><code>${escapeHtml(sourceForBlock(block) || block.text || "")}</code></pre>`;
  }
  return [
    "<table>",
    "  <thead>",
    `    <tr>${table.header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr>`,
    "  </thead>",
    "  <tbody>",
    ...table.body.map((row) => `    <tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`),
    "  </tbody>",
    "</table>",
  ].join("\n");
}

function renderListItemInner(block) {
  const item = parseListItem(block);
  if (block.blockKind === "checklist_item") {
    return `
      <div class="doc-check-row">
        <span class="doc-checkbox">${item.checked ? "☑" : "☐"}</span>
        <div>${renderInlineMarkdown(item.text)}</div>
      </div>
    `;
  }
  return `<div>${renderInlineMarkdown(item.text)}</div>`;
}

function renderBlockBody(block) {
  switch (block.blockKind) {
    case "heading":
      return renderHeadingBlock(block);
    case "paragraph":
      return renderParagraphBlock(block);
    case "quote":
      return renderQuoteBlock(block);
    case "code_block":
      return renderCodeBlock(block);
    case "table":
      return renderTableBlock(block);
    case "list_item":
    case "checklist_item":
      return renderListItemInner(block);
    default:
      return `<p>${renderInlineMarkdown(block.text || "")}</p>`;
  }
}

function renderStandaloneAnchor(block) {
  const draft = draftForAnchor(block.id);
  const threads = threadsForAnchor(block.id);
  return `
    <section class="${blockClasses(block, draft, threads)}" data-anchor-id="${escapeHtml(block.id)}">
      <button class="doc-comment-button" data-comment-anchor="${escapeHtml(block.id)}">Comment</button>
      <div class="doc-anchor-inner">
        ${renderAnchorFlags(block, draft, threads)}
        <div class="doc-anchor-body">${renderBlockBody(block)}</div>
        ${renderAnchorSummary(block, draft, threads)}
      </div>
    </section>
  `;
}

function renderListGroup(node) {
  const tag = node.listKind === "ordered" ? "ol" : "ul";
  const classes = ["doc-list"];
  const startAttr = node.listKind === "ordered"
    ? ` start="${orderedListStart(node.items[0])}"`
    : "";
  if (node.listKind === "checklist") classes.push("checklist");

  return `
    <div class="doc-list-group">
      <${tag} class="${classes.join(" ")}"${startAttr}>
        ${node.items.map((block) => {
          const draft = draftForAnchor(block.id);
          const threads = threadsForAnchor(block.id);
          return `
            <li class="${blockClasses(block, draft, threads)}" data-anchor-id="${escapeHtml(block.id)}">
              <button class="doc-comment-button" data-comment-anchor="${escapeHtml(block.id)}">Comment</button>
              <div class="doc-anchor-inner">
                ${renderAnchorFlags(block, draft, threads)}
                <div class="doc-anchor-body">${renderListItemInner(block)}</div>
                ${renderAnchorSummary(block, draft, threads)}
              </div>
            </li>
          `;
        }).join("")}
      </${tag}>
    </div>
  `;
}

function renderSelectedPreview(block) {
  if (!block) return '<div class="empty">Select a block to review.</div>';
  if (["list_item", "checklist_item"].includes(block.blockKind)) {
    const tag = listKindForBlock(block) === "ordered" ? "ol" : "ul";
    const classes = ["doc-list"];
    if (block.blockKind === "checklist_item") classes.push("checklist");
    const startAttr = listKindForBlock(block) === "ordered"
      ? ` start="${orderedListStart(block)}"`
      : "";
    return `
      <div class="selected-preview">
        <${tag} class="${classes.join(" ")}"${startAttr}>
          <li>
            <div class="doc-anchor-body">${renderListItemInner(block)}</div>
          </li>
        </${tag}>
      </div>
    `;
  }
  return `
    <div class="selected-preview">
      <div class="doc-anchor-body">${renderBlockBody(block)}</div>
    </div>
  `;
}

function threadStatusPill(thread) {
  if (thread.stale) return '<span class="pill bad">stale</span>';
  if (thread.status === "accepted") return '<span class="pill good">accepted</span>';
  if (thread.status === "addressed") return '<span class="pill warn">addressed</span>';
  return '<span class="pill accent">open</span>';
}

function renderMeta() {
  if (!state.summary || !state.viewModel) return;
  els.title.textContent = state.viewModel.title || "Bosun Plan Review";
  els.subtitle.textContent = state.viewModel.mode === "delta"
    ? "Delta review mode: changed anchored excerpts from the current snapshot."
    : "Full review mode: rendered markdown article with inline comments.";

  els.meta.innerHTML = [
    `<span class="meta-pill"><strong>${escapeHtml(state.viewModel.mode)}</strong> mode</span>`,
    `<span class="meta-pill"><strong>${state.summary.threadCount}</strong> threads</span>`,
    `<span class="meta-pill"><strong>${state.summary.staleThreadCount || 0}</strong> stale</span>`,
    `<span class="meta-pill"><strong>${state.drafts.length}</strong> drafts</span>`,
    `<span class="meta-pill"><strong>${state.viewModel.diffSummary.deltaCount}</strong> changed blocks</span>`,
  ].join("");
}

function navigatorItems() {
  if (!state.viewModel) return [];
  const headingBlocks = state.viewModel.blocks.filter((block) => block.blockKind === "heading");
  if (headingBlocks.length > 0) {
    return headingBlocks.map((block) => ({
      id: block.id,
      title: block.text,
      meta: block.headingPath.slice(0, -1).join(" / ") || "Section",
      level: block.headingPath.length || 1,
    }));
  }

  const seen = new Set();
  return state.viewModel.blocks
    .filter((block) => block.headingPath.length > 0)
    .map((block) => ({
      id: block.id,
      title: block.headingPath.at(-1),
      meta: block.headingPath.slice(0, -1).join(" / ") || "Section",
      level: block.headingPath.length || 1,
    }))
    .filter((item) => {
      const key = `${item.title}::${item.meta}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderNavigator() {
  if (!state.summary || !state.viewModel) return;

  const openThreads = state.threads.filter((thread) => thread.status === "open").length;
  const modeButtons = state.viewModel.availableModes
    .map((mode) => `
      <button class="${mode === state.viewModel.mode ? "primary" : "secondary"}" data-mode="${mode}">
        ${mode === "full" ? "Full plan" : "Delta"}
      </button>
    `)
    .join("");

  const headings = navigatorItems()
    .map((item) => `
      <button class="nav-item ${item.id === state.selectedId ? "active" : ""}" data-nav-anchor="${escapeHtml(item.id)}">
        <div class="nav-item-title" style="padding-left: ${(Math.max(item.level, 1) - 1) * 14}px;">${escapeHtml(item.title)}</div>
        <div class="nav-item-meta">${escapeHtml(item.meta)}</div>
      </button>
    `)
    .join("");

  els.navigatorPane.innerHTML = `
    <section class="navigator-card stack">
      <div>
        <div class="section-title">View</div>
        <div class="mode-buttons">${modeButtons}</div>
      </div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Visible blocks</div>
          <div class="stat-value">${state.viewModel.blocks.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Removed in diff</div>
          <div class="stat-value">${state.viewModel.diffSummary.removedCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Open threads</div>
          <div class="stat-value">${openThreads}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Draft queue</div>
          <div class="stat-value">${state.drafts.length}</div>
        </div>
      </div>
    </section>

    <section class="navigator-card stack">
      <div>
        <div class="section-title">Outline</div>
        <div class="muted">Read the plan as a document. Use the outline only to jump between sections.</div>
      </div>
      <div class="nav-list">
        ${headings || '<div class="empty">No headings available in this view.</div>'}
      </div>
    </section>
  `;
}

function renderDocumentHero() {
  if (!state.summary || !state.viewModel) return;
  const latest = state.summary.latestSubmission;
  const modeCopy = state.viewModel.mode === "delta"
    ? "Showing changed excerpts only. Switch to Full plan for uninterrupted reading context."
    : "Showing the current markdown snapshot as a readable document. Hover any block to comment.";
  els.documentHero.innerHTML = `
    <div class="section-title">Plan document</div>
    <h2>${escapeHtml(state.viewModel.title)}</h2>
    <p>${escapeHtml(state.summary.document.planFilePath)}</p>
    <p class="muted" style="margin-top: 10px;">${escapeHtml(modeCopy)}</p>
    <div class="button-row" style="margin-top: 12px;">
      <span class="pill accent">${escapeHtml(state.summary.session.status)}</span>
      <span class="pill">${state.summary.document.anchorCount} anchors</span>
      <span class="pill">${state.summary.submissionCount} submissions</span>
      ${latest ? `<span class="pill ${latest.outcome === "approve" ? "good" : "warn"}">latest: ${escapeHtml(latest.outcome)}</span>` : ""}
    </div>
  `;
}

function renderDocument() {
  if (!state.viewModel) return;
  const nodes = buildDocumentNodes(state.viewModel.blocks);
  els.documentPane.innerHTML = nodes.length
    ? nodes.map((node) => node.kind === "list" ? renderListGroup(node) : renderStandaloneAnchor(node.block)).join("\n")
    : '<div class="empty">No visible blocks in this view.</div>';
}

function renderComposer() {
  const block = currentBlock();
  const draft = selectedDraft();
  const threads = selectedThreads();

  if (!block) {
    return `
      <section class="composer-card stack">
        <div>
          <div class="section-title">Selected block</div>
          <div class="empty">Pick a block in the document to write anchored feedback.</div>
        </div>
      </section>
    `;
  }

  const lineLabel = block.lineStart != null && block.lineEnd != null
    ? `lines ${block.lineStart}-${block.lineEnd}`
    : "line range unavailable";

  return `
    <section class="composer-card stack">
      <div>
        <div class="section-title">Selected block</div>
        <div class="button-row" style="margin-bottom: 10px;">
          <span class="pill">${escapeHtml(block.blockKind)}</span>
          ${showDocumentChangeBadge(block)
            ? `<span class="pill ${block.changeKind === "added" ? "good" : block.changeKind === "modified" ? "warn" : ""}">${escapeHtml(block.changeKind)}</span>`
            : ""}
          <span class="pill">${escapeHtml(lineLabel)}</span>
          ${draft ? '<span class="pill warn">draft queued</span>' : ""}
          ${threads.map((thread) => threadStatusPill(thread)).join("")}
        </div>
        <div class="muted" style="margin-bottom: 10px;">${escapeHtml(block.headingLabel)}</div>
        ${renderSelectedPreview(block)}
      </div>

      ${threads.length ? `
        <div class="stack">
          <div class="section-title">Existing threads on this block</div>
          ${threads.map((thread) => `
            <div class="activity-card">
              <div class="button-row" style="justify-content: space-between; margin-bottom: 6px;">
                ${threadStatusPill(thread)}
                <span class="queue-meta">${escapeHtml(formatDate(thread.updatedAt))}</span>
              </div>
              <div>${escapeHtml(thread.comment)}</div>
              ${thread.suggestion ? `<div class="queue-meta" style="margin-top: 6px;">Suggestion: ${escapeHtml(thread.suggestion)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}

      <label>
        <div class="section-title">Comment</div>
        <textarea id="composer-comment" placeholder="Add feedback for this block..."></textarea>
      </label>

      <label>
        <div class="section-title">Suggestion (optional)</div>
        <textarea id="composer-suggestion" placeholder="Optional suggested replacement or addition..."></textarea>
      </label>

      <div class="composer-actions">
        <button class="primary" id="upsert-draft">${draft ? "Update draft" : "Add draft"}</button>
        ${draft ? '<button class="danger" id="remove-selected-draft">Remove draft</button>' : ""}
      </div>
    </section>
  `;
}

function renderDraftQueue() {
  const items = state.drafts
    .map((draft) => `
      <button class="draft-card queue-item ${draft.anchorId === state.selectedId ? "active" : ""}" data-draft-anchor="${escapeHtml(draft.anchorId || "")}">
        <div class="queue-title">${escapeHtml(draft.headingLabel || "(root)")}</div>
        <div style="margin-top: 6px;">${escapeHtml(draft.comment)}</div>
        ${draft.suggestion ? `<div class="queue-meta" style="margin-top: 6px;">Suggestion: ${escapeHtml(draft.suggestion)}</div>` : ""}
      </button>
    `)
    .join("");

  return `
    <section class="card stack">
      <div class="card-body">
        <div class="section-title">Draft queue</div>
        <div class="queue-list">
          ${items || '<div class="empty">No drafts queued yet.</div>'}
        </div>
      </div>
    </section>
  `;
}

function renderThreadQueue() {
  const threads = [...state.threads].sort((a, b) => {
    const staleDelta = Number(b.stale) - Number(a.stale);
    if (staleDelta !== 0) return staleDelta;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });

  const items = threads
    .map((thread) => `
      <button class="thread-card queue-item ${thread.anchorId === state.selectedId ? "active" : ""}" ${thread.anchorId ? `data-thread-anchor="${escapeHtml(thread.anchorId)}"` : "disabled"}>
        <div class="button-row" style="justify-content: space-between; width: 100%; margin-bottom: 8px;">
          <div class="queue-title">${escapeHtml(thread.headingLabel || "(root)")}</div>
          ${threadStatusPill(thread)}
        </div>
        <div>${escapeHtml(thread.comment)}</div>
        ${thread.suggestion ? `<div class="queue-meta" style="margin-top: 6px;">Suggestion: ${escapeHtml(thread.suggestion)}</div>` : ""}
      </button>
    `)
    .join("");

  return `
    <section class="card stack">
      <div class="card-body">
        <div class="section-title">Threads</div>
        <div class="queue-list">
          ${items || '<div class="empty">No threads yet.</div>'}
        </div>
      </div>
    </section>
  `;
}

function renderGlobalNote() {
  return `
    <section class="card stack">
      <div class="card-body">
        <div class="section-title">Global review note</div>
        <textarea id="global-comment-input" placeholder="Optional overall note for the whole plan..."></textarea>
      </div>
    </section>
  `;
}

function renderActivity() {
  const latest = state.summary?.latestSubmission;
  const items = (state.recentEvents || [])
    .map((event) => `
      <div class="activity-card">
        <div class="button-row" style="justify-content: space-between; margin-bottom: 6px;">
          <span class="pill">${escapeHtml(event.type)}</span>
          <span class="queue-meta">${escapeHtml(formatDate(event.createdAt))}</span>
        </div>
        <div>${escapeHtml(event.summary)}</div>
      </div>
    `)
    .join("");

  return `
    <section class="card stack">
      <div class="card-body">
        <div class="section-title">Activity</div>
        ${latest ? `
          <div class="activity-card" style="margin-bottom: 10px;">
            <div class="button-row" style="justify-content: space-between; margin-bottom: 6px;">
              <span class="pill ${latest.outcome === "approve" ? "good" : "warn"}">${escapeHtml(latest.outcome)}</span>
              <span class="queue-meta">${escapeHtml(formatDate(latest.createdAt))}</span>
            </div>
            <div>${escapeHtml(latest.summary)}</div>
          </div>
        ` : ""}
        <div class="activity-list">
          ${items || '<div class="empty">No review activity yet.</div>'}
        </div>
      </div>
    </section>
  `;
}

function renderSidebar() {
  els.sidebarPane.innerHTML = [
    renderComposer(),
    renderDraftQueue(),
    renderThreadQueue(),
    renderGlobalNote(),
    renderActivity(),
  ].join("");
}

function bindStaticControls() {
  els.summaryInput.value = state.summaryText;
  els.reroundSummaryInput.value = state.reroundSummaryText;

  els.summaryInput.oninput = (event) => {
    state.summaryText = event.target.value;
  };
  els.reroundSummaryInput.oninput = (event) => {
    state.reroundSummaryText = event.target.value;
  };
  els.submitRequestChanges.onclick = () => submit("request_changes");
  els.submitApprove.onclick = () => submit("approve");
  els.publishReround.onclick = () => publishReround();
}

function bindSidebarControls() {
  const composerComment = document.getElementById("composer-comment");
  const composerSuggestion = document.getElementById("composer-suggestion");
  const upsertDraftButton = document.getElementById("upsert-draft");
  const removeSelectedDraftButton = document.getElementById("remove-selected-draft");
  const globalCommentInput = document.getElementById("global-comment-input");

  if (composerComment) {
    composerComment.value = state.composerComment;
    composerComment.oninput = (event) => {
      state.composerComment = event.target.value;
    };
  }

  if (composerSuggestion) {
    composerSuggestion.value = state.composerSuggestion;
    composerSuggestion.oninput = (event) => {
      state.composerSuggestion = event.target.value;
    };
  }

  if (upsertDraftButton) {
    upsertDraftButton.onclick = () => upsertSelectedDraft();
  }

  if (removeSelectedDraftButton) {
    removeSelectedDraftButton.onclick = () => removeSelectedDraft();
  }

  if (globalCommentInput) {
    globalCommentInput.value = state.globalComment;
    globalCommentInput.oninput = (event) => {
      state.globalComment = event.target.value;
      queueDraftSave();
    };
  }

  document.querySelectorAll("[data-draft-anchor]").forEach((node) => {
    node.addEventListener("click", () => {
      const anchorId = node.getAttribute("data-draft-anchor");
      if (anchorId) selectBlock(anchorId, { scroll: true });
    });
  });

  document.querySelectorAll("[data-thread-anchor]").forEach((node) => {
    node.addEventListener("click", () => {
      const anchorId = node.getAttribute("data-thread-anchor");
      if (anchorId) selectBlock(anchorId, { scroll: true });
    });
  });
}

function bindNavigatorControls() {
  document.querySelectorAll("[data-mode]").forEach((node) => {
    node.addEventListener("click", () => {
      void loadSession(node.getAttribute("data-mode") || "full");
    });
  });

  document.querySelectorAll("[data-nav-anchor]").forEach((node) => {
    node.addEventListener("click", () => {
      const anchorId = node.getAttribute("data-nav-anchor");
      if (anchorId) selectBlock(anchorId, { scroll: true });
    });
  });
}

function bindDocumentControls() {
  document.querySelectorAll("[data-anchor-id]").forEach((node) => {
    node.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      const anchorId = node.getAttribute("data-anchor-id");
      if (anchorId) selectBlock(anchorId, { scroll: false });
    });
  });

  document.querySelectorAll("[data-comment-anchor]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      const anchorId = node.getAttribute("data-comment-anchor");
      if (anchorId) selectBlock(anchorId, { focusComposer: true, scroll: false });
    });
  });
}

function scrollTargetIntoViewIfNeeded(target) {
  const container = target?.closest(".panel-scroll, .right-rail-scroll");
  if (!target || !container) {
    target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const topPadding = 24;
  const bottomPadding = 24;
  const fullyVisible =
    targetRect.top >= containerRect.top + topPadding &&
    targetRect.bottom <= containerRect.bottom - bottomPadding;

  if (fullyVisible) return;
  target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

function applyPostRenderEffects() {
  if (state.pendingFocusComposer) {
    const composerComment = document.getElementById("composer-comment");
    if (composerComment) {
      requestAnimationFrame(() => composerComment.focus());
    }
    state.pendingFocusComposer = false;
  }

  if (state.pendingScrollId) {
    const target = document.querySelector(`[data-anchor-id="${selectorEscape(state.pendingScrollId)}"]`);
    if (target) {
      requestAnimationFrame(() => {
        scrollTargetIntoViewIfNeeded(target);
      });
    }
    state.pendingScrollId = null;
  }
}

function upsertSelectedDraft() {
  const anchor = currentAnchor();
  const block = currentBlock();
  const comment = state.composerComment.trim();
  const suggestion = state.composerSuggestion.trim();

  if (!anchor || !block) {
    setStatus("Select a block before writing feedback.", "error");
    return;
  }

  if (!comment) {
    setStatus("Comment is required.", "error");
    return;
  }

  const nextDraft = {
    anchor,
    anchorId: block.id,
    headingLabel: block.headingLabel,
    comment,
    suggestion: suggestion || null,
    threadId: selectedDraft()?.threadId || null,
  };

  const existingIndex = state.drafts.findIndex((draft) => draft.anchorId === block.id);
  if (existingIndex >= 0) {
    state.drafts[existingIndex] = { ...state.drafts[existingIndex], ...nextDraft };
    setStatus(`Updated draft for ${block.headingLabel}.`, "success");
  } else {
    state.drafts.push(nextDraft);
    setStatus(`Added draft for ${block.headingLabel}.`, "success");
  }

  queueDraftSave();
  render();
}

function removeSelectedDraft() {
  const block = currentBlock();
  if (!block) return;
  state.drafts = state.drafts.filter((draft) => draft.anchorId !== block.id);
  state.composerComment = "";
  state.composerSuggestion = "";
  queueDraftSave();
  setStatus(`Removed draft for ${block.headingLabel}.`, "success");
  render();
}

async function publishReround() {
  try {
    const summary = state.reroundSummaryText.trim() || undefined;
    setStatus("Publishing reround from current plan file...");

    const response = await fetch("/api/reround", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary }),
    });

    if (!response.ok) {
      setStatus(await response.text(), "error");
      return;
    }

    state.reroundSummaryText = "";
    await loadSession("delta");
    setStatus("Published reround and switched to delta view.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function submit(outcome) {
  try {
    if (state.composerComment.trim()) {
      const draft = selectedDraft();
      if (!draft || draft.comment !== state.composerComment.trim() || (draft.suggestion || "") !== state.composerSuggestion.trim()) {
        upsertSelectedDraft();
      }
    }

    if (outcome === "request_changes" && state.drafts.length === 0 && !state.globalComment.trim()) {
      setStatus("Add draft feedback or a global note before requesting changes.", "error");
      return;
    }

    setStatus("Submitting review result...");
    const response = await fetch("/api/submission", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        outcome,
        summary: state.summaryText.trim() || undefined,
        globalComment: state.globalComment,
        feedback: state.drafts.map((draft) => ({
          anchor: draft.anchor,
          comment: draft.comment,
          suggestion: draft.suggestion,
          threadId: draft.threadId || null,
        })),
      }),
    });

    if (!response.ok) {
      setStatus(await response.text(), "error");
      return;
    }

    state.drafts = [];
    state.globalComment = "";
    state.summaryText = "";
    state.composerComment = "";
    state.composerSuggestion = "";
    await loadSession(state.mode);
    setStatus(`Submitted ${outcome.replaceAll("_", " ")}.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function loadSession(mode = state.mode || "full") {
  state.mode = mode;
  const response = await fetch(`/api/session?mode=${encodeURIComponent(mode)}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  state.summary = payload.summary;
  state.viewModel = payload.viewModel;
  state.mode = payload.viewModel.mode;
  state.markdown = payload.markdown;
  state.markdownLines = normalizeMarkdown(payload.markdown).split("\n");
  state.globalAnchor = payload.globalAnchor;
  state.threads = hydrateThreads(payload.threads || []);
  state.recentEvents = payload.recentEvents || [];
  state.drafts = hydrateDrafts(payload.draftState?.drafts || []);
  state.globalComment = payload.draftState?.globalComment || "";

  if (!state.selectedId && state.viewModel.blocks.length > 0) {
    state.selectedId = state.viewModel.blocks[0].id;
  }
  if (state.selectedId && !state.viewModel.blocks.some((block) => block.id === state.selectedId)) {
    state.selectedId = state.viewModel.blocks[0]?.id ?? null;
  }

  syncComposerFromSelection();
  render();
}

function render() {
  renderMeta();
  renderNavigator();
  renderDocumentHero();
  renderDocument();
  renderSidebar();
  bindStaticControls();
  bindNavigatorControls();
  bindDocumentControls();
  bindSidebarControls();
  applyPostRenderEffects();
}

loadSession().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), "error");
});
