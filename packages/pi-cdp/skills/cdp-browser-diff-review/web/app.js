const state = {
  sessionPayload: null,
  activeMode: "delta",
  activePath: null,
  activeFileData: null,
  fileCache: new Map(),
  drafts: [],
  wrapLines: true,
  hideUnchanged: false,
  reviewedPaths: new Set(),
  selectedThreadId: null,
  selectedDraftIds: new Set(),
  loadingSession: false,
  unreadRoundReady: false,
};

const dom = {
  sessionTitle: document.getElementById("session-title"),
  sessionStatus: document.getElementById("session-status"),
  roundReadyPill: document.getElementById("round-ready-pill"),
  sessionSubtitle: document.getElementById("session-subtitle"),
  targetAgentPill: document.getElementById("target-agent-pill"),
  roundPill: document.getElementById("round-pill"),
  refreshButton: document.getElementById("refresh-button"),
  submitBatchButton: document.getElementById("submit-batch-button"),
  roundHeading: document.getElementById("round-heading"),
  roundDetail: document.getElementById("round-detail"),
  openRelatedThreadsButton: document.getElementById("open-related-threads-button"),
  navigator: document.getElementById("navigator"),
  fileSearch: document.getElementById("file-search"),
  addFileCommentButton: document.getElementById("add-file-comment-button"),
  toggleReviewedButton: document.getElementById("toggle-reviewed-button"),
  toggleWrapButton: document.getElementById("toggle-wrap-button"),
  toggleUnchangedButton: document.getElementById("toggle-unchanged-button"),
  activeFileLabel: document.getElementById("active-file-label"),
  activeFileHint: document.getElementById("active-file-hint"),
  activeFileBadges: document.getElementById("active-file-badges"),
  editor: document.getElementById("editor"),
  drafts: document.getElementById("drafts"),
  clearDraftsButton: document.getElementById("clear-drafts-button"),
  submitDraftsInlineButton: document.getElementById("submit-drafts-inline-button"),
  threads: document.getElementById("threads"),
  threadSearch: document.getElementById("thread-search"),
  toasts: document.getElementById("toasts"),
  modalRoot: document.getElementById("modal-root"),
  modeButtons: [...document.querySelectorAll("#mode-switch button[data-mode]")],
};

let monacoApi = null;
let diffEditor = null;
let originalModel = null;
let modifiedModel = null;
let originalDecorations = [];
let modifiedDecorations = [];
let eventUnsubscribers = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function humanStatus(value) {
  if (!value) return "unknown";
  return String(value).replaceAll("-", " ");
}

function inferLanguage(path, fallback) {
  if (fallback) return fallback;
  const lower = String(path || "").toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".sh")) return "shell";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".zig")) return "cpp";
  return "plaintext";
}

function showToast(title, message, ttl = 5000) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  dom.toasts.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.25s ease";
    setTimeout(() => toast.remove(), 260);
  }, ttl);
}

function currentRound() {
  return state.sessionPayload?.latestRound ?? null;
}

function currentFiles() {
  const payload = state.sessionPayload;
  if (!payload?.files) return [];
  return payload.files[state.activeMode] ?? [];
}

function allThreads() {
  return state.sessionPayload?.threads ?? [];
}

function updateTopBar() {
  const payload = state.sessionPayload;
  const session = payload?.session;
  const round = currentRound();
  dom.sessionTitle.textContent = session?.title || "Bosun Diff Review";
  dom.sessionStatus.textContent = humanStatus(session?.status || (state.loadingSession ? "loading" : "idle"));
  dom.sessionSubtitle.textContent = session
    ? `${session.repoRoot || "repo"} • ${session.id || "session"}`
    : "Loading session…";
  dom.targetAgentPill.textContent = `agent ${session?.targetAgent || "—"}`;
  dom.roundPill.textContent = round ? `round ${round.number ?? round.id ?? "—"}` : "round —";
  dom.roundHeading.textContent = round
    ? `${round.kind === "reround" ? "Re-review" : "Initial review"} • round ${round.number ?? round.id ?? "?"}`
    : "No round loaded";
  dom.roundDetail.textContent = round
    ? `${round.summary || "No summary provided."} (${(round.changedFiles || []).length} changed file(s))`
    : "Waiting for review state.";
  dom.roundReadyPill.classList.toggle("hidden", !state.unreadRoundReady);
}

function fileMatchQuery(file, query) {
  if (!query) return true;
  const haystack = `${file.path || ""} ${file.displayPath || ""}`.toLowerCase();
  return haystack.includes(query);
}

function threadMatchQuery(thread, query) {
  if (!query) return true;
  const messageText = (thread.messages || []).map((message) => `${message.author || ""} ${message.body || ""}`).join(" ");
  return `${thread.path || ""} ${thread.title || ""} ${messageText}`.toLowerCase().includes(query);
}

function fileDraftCount(path) {
  return state.drafts.filter((draft) => draft.path === path).length;
}

function fileThreadCounts(path) {
  const matching = allThreads().filter((thread) => thread.path === path);
  return {
    open: matching.filter((thread) => thread.status !== "accepted").length,
    stale: matching.filter((thread) => thread.stale).length,
  };
}

function renderNavigator() {
  const query = dom.fileSearch.value.trim().toLowerCase();
  const files = currentFiles().filter((file) => fileMatchQuery(file, query));
  const roundChangedSet = new Set((currentRound()?.changedFiles || []).map((value) => String(value)));
  const openThreadSet = new Set(
    allThreads()
      .filter((thread) => thread.status !== "accepted")
      .map((thread) => String(thread.path)),
  );
  const staleThreadSet = new Set(
    allThreads()
      .filter((thread) => thread.stale)
      .map((thread) => String(thread.path)),
  );

  const sections = [
    {
      title: "Changed this round",
      files: files.filter((file) => roundChangedSet.has(String(file.path))),
    },
    {
      title: "Open or stale threads",
      files: files.filter((file) => openThreadSet.has(String(file.path)) || staleThreadSet.has(String(file.path))),
    },
    {
      title: "All files in current mode",
      files,
    },
  ];

  const renderedPaths = new Set();
  const html = [];

  for (const section of sections) {
    const uniqueFiles = section.files.filter((file) => {
      const key = String(file.path);
      if (section.title !== "All files in current mode" && renderedPaths.has(key)) return false;
      renderedPaths.add(key);
      return true;
    });
    if (!uniqueFiles.length) continue;
    html.push(`<div class="section"><div class="section-title"><span>${escapeHtml(section.title)}</span><span>${uniqueFiles.length}</span></div>`);
    for (const file of uniqueFiles) {
      const counts = fileThreadCounts(file.path);
      const badges = [];
      if (roundChangedSet.has(String(file.path))) badges.push(`<span class="badge changed">${escapeHtml(file.status || "changed")}</span>`);
      if (counts.open > 0) badges.push(`<span class="badge open">${counts.open} open</span>`);
      if (counts.stale > 0) badges.push(`<span class="badge stale">${counts.stale} stale</span>`);
      if (state.reviewedPaths.has(file.path) || file.reviewed) badges.push(`<span class="badge reviewed">reviewed</span>`);
      const draftCount = fileDraftCount(file.path);
      if (draftCount > 0) badges.push(`<span class="badge">${draftCount} draft</span>`);
      html.push(`
        <button class="file-item ${state.activePath === file.path ? "active" : ""}" data-path="${escapeHtml(file.path)}">
          <div class="file-meta"><span>${escapeHtml(file.displayPath || file.path)}</span><span>${escapeHtml(file.status || "")}</span></div>
          <div class="file-path">${escapeHtml(file.path)}</div>
          <div class="badge-row">${badges.join("") || `<span class="badge">in scope</span>`}</div>
        </button>
      `);
    }
    html.push(`</div>`);
  }

  if (!html.length) {
    dom.navigator.innerHTML = `<div class="empty">No files match the current scope.</div>`;
    return;
  }

  dom.navigator.innerHTML = html.join("");
  for (const button of dom.navigator.querySelectorAll("[data-path]")) {
    button.addEventListener("click", () => openFile(button.getAttribute("data-path")));
  }
}

function latestThreadBody(thread) {
  const messages = thread.messages || [];
  return messages.length ? messages[messages.length - 1].body || "" : thread.body || "";
}

function renderThreads() {
  const query = dom.threadSearch.value.trim().toLowerCase();
  const threads = allThreads().filter((thread) => threadMatchQuery(thread, query));
  if (!threads.length) {
    dom.threads.innerHTML = `<div class="empty">No open or stale threads in this session.</div>`;
    return;
  }
  const sorted = [...threads].sort((a, b) => {
    const aScore = (a.status === "accepted" ? 1 : 0) + (a.stale ? 0 : 0);
    const bScore = (b.status === "accepted" ? 1 : 0) + (b.stale ? 0 : 0);
    if (aScore !== bScore) return aScore - bScore;
    return String(a.path || "").localeCompare(String(b.path || ""));
  });
  dom.threads.innerHTML = sorted.map((thread) => {
    const actions = [];
    if (thread.status !== "accepted") actions.push(`<button data-thread-action="accept" data-thread-id="${escapeHtml(thread.id)}">Accept</button>`);
    if (thread.status === "accepted" || thread.status === "addressed") actions.push(`<button data-thread-action="reopen" data-thread-id="${escapeHtml(thread.id)}">Reopen</button>`);
    actions.push(`<button data-thread-action="reply" data-thread-id="${escapeHtml(thread.id)}">Reply</button>`);
    return `
      <div class="thread-item ${state.selectedThreadId === thread.id ? "active" : ""}" data-thread-open="${escapeHtml(thread.id)}">
        <div class="thread-meta">
          <span>${escapeHtml(thread.path || "(unknown file)")}</span>
          <span>${escapeHtml(thread.status || "open")}${thread.stale ? " • stale" : ""}</span>
        </div>
        <div class="badge-row">
          <span class="badge ${thread.status === "accepted" ? "reviewed" : "open"}">${escapeHtml(thread.status || "open")}</span>
          ${thread.stale ? `<span class="badge stale">stale anchor</span>` : ""}
          ${thread.anchor?.startLine ? `<span class="badge">line ${escapeHtml(thread.anchor.startLine)}</span>` : ""}
        </div>
        <div class="thread-body">${escapeHtml(latestThreadBody(thread) || thread.title || "No thread body yet.")}</div>
        <div class="thread-actions">${actions.join("")}</div>
      </div>
    `;
  }).join("");

  for (const item of dom.threads.querySelectorAll("[data-thread-open]")) {
    item.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("button[data-thread-action]")) return;
      const threadId = item.getAttribute("data-thread-open");
      focusThread(threadId);
    });
  }

  for (const button of dom.threads.querySelectorAll("button[data-thread-action]")) {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const threadId = button.getAttribute("data-thread-id");
      const action = button.getAttribute("data-thread-action");
      if (!threadId || !action) return;
      if (action === "reply") {
        openReplyModal(threadId);
        return;
      }
      if (action === "accept") {
        await sendBridgeAction({ type: "review.thread.accept", threadId });
        return;
      }
      if (action === "reopen") {
        await sendBridgeAction({ type: "review.thread.reopen", threadId });
      }
    });
  }
}

function renderDrafts() {
  if (!state.drafts.length) {
    dom.drafts.innerHTML = `<div class="empty">Drafts stay local until you submit a batch. Add inline or file comments to build the batch.</div>`;
    updateSubmitButtons();
    return;
  }

  dom.drafts.innerHTML = state.drafts.map((draft) => {
    const location = draft.kind === "file"
      ? `${draft.path} • file comment`
      : `${draft.path} • ${draft.side || "modified"} line ${draft.startLine || "?"}`;
    return `
      <div class="draft-item">
        <div class="draft-meta"><span>${escapeHtml(location)}</span><span>${escapeHtml(draft.mode || state.activeMode)}</span></div>
        <div class="draft-body">${escapeHtml(draft.body)}</div>
        <div class="draft-actions-row">
          <button data-draft-action="edit" data-draft-id="${escapeHtml(draft.id)}">Edit</button>
          <button data-draft-action="remove" data-draft-id="${escapeHtml(draft.id)}">Remove</button>
        </div>
      </div>
    `;
  }).join("");

  for (const button of dom.drafts.querySelectorAll("button[data-draft-action]")) {
    button.addEventListener("click", () => {
      const draftId = button.getAttribute("data-draft-id");
      const action = button.getAttribute("data-draft-action");
      if (!draftId || !action) return;
      if (action === "remove") {
        state.drafts = state.drafts.filter((draft) => draft.id !== draftId);
        renderDrafts();
        renderNavigator();
        refreshDecorations();
        return;
      }
      const draft = state.drafts.find((item) => item.id === draftId);
      if (!draft) return;
      openDraftModal({
        title: "Edit draft",
        draft,
        onSave(body) {
          draft.body = body;
          renderDrafts();
        },
      });
    });
  }

  updateSubmitButtons();
}

function updateSubmitButtons() {
  const disabled = state.drafts.length === 0;
  dom.submitBatchButton.disabled = disabled;
  dom.submitDraftsInlineButton.disabled = disabled;
}

function updateFileHeader() {
  const data = state.activeFileData;
  if (!state.activePath) {
    dom.activeFileLabel.textContent = "No file selected";
    dom.activeFileHint.textContent = "Select a file from the review navigator.";
    dom.activeFileBadges.innerHTML = "";
    return;
  }
  dom.activeFileLabel.textContent = data?.displayPath || state.activePath;
  dom.activeFileHint.textContent = data?.hint || `${humanStatus(state.activeMode)} view for this diff.`;
  const counts = fileThreadCounts(state.activePath);
  const badges = [];
  if (data?.status) badges.push(`<span class="badge changed">${escapeHtml(data.status)}</span>`);
  if (counts.open > 0) badges.push(`<span class="badge open">${counts.open} open</span>`);
  if (counts.stale > 0) badges.push(`<span class="badge stale">${counts.stale} stale</span>`);
  if (state.reviewedPaths.has(state.activePath) || data?.reviewed) badges.push(`<span class="badge reviewed">reviewed</span>`);
  dom.activeFileBadges.innerHTML = badges.join("");
  dom.toggleReviewedButton.textContent = (state.reviewedPaths.has(state.activePath) || data?.reviewed) ? "Reviewed" : "Mark reviewed";
}

function modeButton(mode) {
  return dom.modeButtons.find((button) => button.dataset.mode === mode);
}

function updateModeButtons() {
  for (const button of dom.modeButtons) {
    button.classList.toggle("active", button.dataset.mode === state.activeMode);
  }
}

function makeModal(contentBuilder) {
  dom.modalRoot.innerHTML = "";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  contentBuilder(modal, () => backdrop.remove());
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  dom.modalRoot.appendChild(backdrop);
  return backdrop;
}

function openDraftModal({ title, description, draft, onSave }) {
  const backdrop = makeModal((modal, close) => {
    modal.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description || "Draft review comments stay local until you submit a review batch.")}</p>
      <textarea>${escapeHtml(draft.body || "")}</textarea>
      <div class="modal-actions">
        <button data-action="cancel">Cancel</button>
        <button class="primary" data-action="save">Save draft</button>
      </div>
    `;
    const textarea = modal.querySelector("textarea");
    modal.querySelector('[data-action="cancel"]').addEventListener("click", close);
    modal.querySelector('[data-action="save"]').addEventListener("click", () => {
      const body = textarea.value.trim();
      if (!body) return;
      onSave(body);
      close();
      renderNavigator();
      renderDrafts();
      refreshDecorations();
    });
    textarea.focus();
  });
  return backdrop;
}

function createDraft(base) {
  const draft = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ...base };
  openDraftModal({
    title: base.kind === "file" ? "Add file comment" : "Add inline comment",
    description: base.kind === "file"
      ? `This draft will be included in the next review batch for ${base.path}.`
      : `This draft will be included in the next review batch for ${base.path}, ${base.side || "modified"} line ${base.startLine || "?"}.`,
    draft,
    onSave(body) {
      draft.body = body;
      state.drafts.push(draft);
    },
  });
}

function openReplyModal(threadId) {
  const thread = allThreads().find((item) => item.id === threadId);
  if (!thread) return;
  makeModal((modal, close) => {
    modal.innerHTML = `
      <h3>Reply to thread</h3>
      <p>${escapeHtml(thread.path || "Unknown file")} • Replies are sent immediately over mesh and attached to this thread.</p>
      <textarea placeholder="Reply to the implementing agent"></textarea>
      <div class="modal-actions">
        <button data-action="cancel">Cancel</button>
        <button class="primary" data-action="send">Send reply</button>
      </div>
    `;
    const textarea = modal.querySelector("textarea");
    modal.querySelector('[data-action="cancel"]').addEventListener("click", close);
    modal.querySelector('[data-action="send"]').addEventListener("click", async () => {
      const body = textarea.value.trim();
      if (!body) return;
      await sendBridgeAction({ type: "review.thread.reply", threadId, body });
      close();
    });
    textarea.focus();
  });
}

function focusThread(threadId) {
  const thread = allThreads().find((item) => item.id === threadId);
  if (!thread) return;
  state.selectedThreadId = threadId;
  if (thread.path) openFile(thread.path, { revealThread: thread });
  renderThreads();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function refreshSession({ quiet = false } = {}) {
  state.loadingSession = true;
  updateTopBar();
  try {
    const payload = await fetchJson("/api/session");
    state.sessionPayload = payload;
    state.reviewedPaths = new Set(payload.reviewedPaths || payload.session?.reviewedPaths || []);
    const files = currentFiles();
    if (!state.activePath || !files.some((file) => file.path === state.activePath)) {
      state.activePath = files[0]?.path || null;
      state.activeFileData = null;
    }
    updateTopBar();
    updateModeButtons();
    renderNavigator();
    renderThreads();
    renderDrafts();
    await openFile(state.activePath, { keepCurrentIfSame: true });
    if (!quiet) showToast("Session refreshed", payload.latestRound?.summary || "Review state updated.", 2200);
  } catch (error) {
    console.error(error);
    showToast("Refresh failed", error instanceof Error ? error.message : String(error), 5000);
  } finally {
    state.loadingSession = false;
    updateTopBar();
  }
}

function fileCacheKey(path, mode, roundId) {
  return `${mode}:${roundId || "latest"}:${path}`;
}

async function loadFile(path) {
  if (!path) {
    state.activeFileData = null;
    updateFileHeader();
    mountEditorData(null);
    return;
  }
  const roundId = currentRound()?.id || "latest";
  const key = fileCacheKey(path, state.activeMode, roundId);
  if (state.fileCache.has(key)) {
    state.activeFileData = state.fileCache.get(key);
    updateFileHeader();
    mountEditorData(state.activeFileData);
    return;
  }
  dom.editor.innerHTML = `<div class="editor-loading">Loading ${escapeHtml(path)}…</div>`;
  try {
    const url = `/api/file?path=${encodeURIComponent(path)}&mode=${encodeURIComponent(state.activeMode)}&roundId=${encodeURIComponent(roundId)}`;
    const data = await fetchJson(url);
    state.fileCache.set(key, data);
    state.activeFileData = data;
    updateFileHeader();
    mountEditorData(data);
  } catch (error) {
    console.error(error);
    state.activeFileData = {
      path,
      displayPath: path,
      originalContent: `Failed to load ${path}\n\n${error instanceof Error ? error.message : String(error)}`,
      modifiedContent: `Failed to load ${path}\n\n${error instanceof Error ? error.message : String(error)}`,
      language: "plaintext",
      status: "error",
      hint: "The bridge could not provide this file payload.",
    };
    updateFileHeader();
    mountEditorData(state.activeFileData);
  }
}

async function openFile(path, options = {}) {
  if (!path) {
    state.activePath = null;
    state.activeFileData = null;
    updateFileHeader();
    renderNavigator();
    mountEditorData(null);
    return;
  }
  if (!options.keepCurrentIfSame || state.activePath !== path) {
    state.activePath = path;
    state.selectedThreadId = options.revealThread?.id || state.selectedThreadId;
  }
  renderNavigator();
  renderThreads();
  await loadFile(path);
  if (options.revealThread) revealThread(options.revealThread);
}

function revealThread(thread) {
  if (!diffEditor || !thread?.anchor?.startLine) return;
  const line = Number(thread.anchor.startLine);
  const editor = thread.anchor.side === "original"
    ? diffEditor.getOriginalEditor()
    : diffEditor.getModifiedEditor();
  if (!Number.isFinite(line)) return;
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: 1 });
  editor.focus();
}

function ensureMonaco() {
  if (monacoApi) return Promise.resolve(monacoApi);
  return new Promise((resolve) => {
    window.require.config({
      paths: {
        vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
      },
    });
    window.require(["vs/editor/editor.main"], () => {
      monacoApi = window.monaco;
      monacoApi.editor.defineTheme("bosun-diff-review", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#0d1320",
          "diffEditor.insertedTextBackground": "#194d332e",
          "diffEditor.removedTextBackground": "#6b23302e",
          "diffEditor.diagonalFill": "#0d1320",
        },
      });
      monacoApi.editor.setTheme("bosun-diff-review");
      resolve(monacoApi);
    });
  });
}

function cleanupEditorListeners() {
  for (const dispose of eventUnsubscribers) {
    try { dispose(); } catch {}
  }
  eventUnsubscribers = [];
}

function makeEditorDecoration(range, className, glyphClass) {
  return {
    range,
    options: {
      isWholeLine: true,
      className,
      glyphMarginClassName: glyphClass,
    },
  };
}

function refreshDecorations() {
  if (!diffEditor || !monacoApi || !state.activePath) return;
  const currentThreads = allThreads().filter((thread) => thread.path === state.activePath);
  const currentDrafts = state.drafts.filter((draft) => draft.path === state.activePath);

  const originalEntries = [];
  const modifiedEntries = [];

  for (const thread of currentThreads) {
    const line = Number(thread.anchor?.startLine || 0);
    if (!line) continue;
    const className = thread.stale ? "bosun-thread-stale" : thread.status === "accepted" ? "bosun-thread-accepted" : "bosun-thread-open";
    const glyphClass = thread.stale ? "bosun-glyph-stale" : thread.status === "accepted" ? "bosun-glyph-accepted" : "bosun-glyph-open";
    const decoration = makeEditorDecoration(new monacoApi.Range(line, 1, line, 1), className, glyphClass);
    if (thread.anchor?.side === "original") originalEntries.push(decoration);
    else modifiedEntries.push(decoration);
  }

  for (const draft of currentDrafts) {
    const line = Number(draft.startLine || 0);
    if (!line || draft.kind !== "inline") continue;
    const decoration = makeEditorDecoration(new monacoApi.Range(line, 1, line, 1), "bosun-draft-line", "bosun-glyph-draft");
    if (draft.side === "original") originalEntries.push(decoration);
    else modifiedEntries.push(decoration);
  }

  originalDecorations = diffEditor.getOriginalEditor().deltaDecorations(originalDecorations, originalEntries);
  modifiedDecorations = diffEditor.getModifiedEditor().deltaDecorations(modifiedDecorations, modifiedEntries);
}

function installEditorStyles() {
  if (document.getElementById("bosun-diff-review-editor-style")) return;
  const style = document.createElement("style");
  style.id = "bosun-diff-review-editor-style";
  style.textContent = `
    .monaco-editor .bosun-thread-open { background: rgba(240, 180, 41, 0.16); }
    .monaco-editor .bosun-thread-accepted { background: rgba(61, 220, 151, 0.16); }
    .monaco-editor .bosun-thread-stale { background: rgba(255, 107, 129, 0.16); }
    .monaco-editor .bosun-draft-line { background: rgba(103, 179, 255, 0.14); }
    .monaco-editor .bosun-glyph-open,
    .monaco-editor .bosun-glyph-accepted,
    .monaco-editor .bosun-glyph-stale,
    .monaco-editor .bosun-glyph-draft,
    .monaco-editor .bosun-glyph-add {
      width: 12px !important;
      height: 12px !important;
      border-radius: 999px;
      margin-left: 5px;
      margin-top: 5px;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.14);
    }
    .monaco-editor .bosun-glyph-open { background: #f0b429; }
    .monaco-editor .bosun-glyph-accepted { background: #3ddc97; }
    .monaco-editor .bosun-glyph-stale { background: #ff6b81; }
    .monaco-editor .bosun-glyph-draft { background: #67b3ff; }
    .monaco-editor .bosun-glyph-add { background: #87cefa; }
  `;
  document.head.appendChild(style);
}

function applyEditorOptions() {
  if (!diffEditor) return;
  diffEditor.updateOptions({
    diffWordWrap: state.wrapLines ? "on" : "off",
    renderSideBySide: true,
    hideUnchangedRegions: {
      enabled: state.hideUnchanged,
      contextLineCount: 4,
      minimumLineCount: 3,
      revealLineCount: 10,
    },
  });
  diffEditor.getOriginalEditor().updateOptions({ wordWrap: state.wrapLines ? "on" : "off" });
  diffEditor.getModifiedEditor().updateOptions({ wordWrap: state.wrapLines ? "on" : "off" });
}

function installInlineDraftActions(editor, side) {
  let hoverDecorationIds = [];
  const onMove = editor.onMouseMove((event) => {
    if (!monacoApi || !state.activePath) return;
    const target = event.target;
    if (target.type === monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || target.type === monacoApi.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
      const line = target.position?.lineNumber;
      if (!line) return;
      hoverDecorationIds = editor.deltaDecorations(hoverDecorationIds, [{
        range: new monacoApi.Range(line, 1, line, 1),
        options: { glyphMarginClassName: "bosun-glyph-add" },
      }]);
      return;
    }
    hoverDecorationIds = editor.deltaDecorations(hoverDecorationIds, []);
  });
  const onLeave = editor.onMouseLeave(() => {
    hoverDecorationIds = editor.deltaDecorations(hoverDecorationIds, []);
  });
  const onDown = editor.onMouseDown((event) => {
    if (!monacoApi || !state.activePath) return;
    const target = event.target;
    if (target.type === monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || target.type === monacoApi.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
      const line = target.position?.lineNumber;
      if (!line) return;
      createDraft({
        kind: "inline",
        path: state.activePath,
        mode: state.activeMode,
        roundId: currentRound()?.id || null,
        side,
        startLine: line,
        endLine: line,
        body: "",
      });
    }
  });
  eventUnsubscribers.push(() => onMove.dispose());
  eventUnsubscribers.push(() => onLeave.dispose());
  eventUnsubscribers.push(() => onDown.dispose());
}

async function mountEditorData(data) {
  await ensureMonaco();
  installEditorStyles();
  if (!diffEditor) {
    dom.editor.innerHTML = "";
    diffEditor = monacoApi.editor.createDiffEditor(dom.editor, {
      automaticLayout: true,
      readOnly: true,
      glyphMargin: true,
      renderOverviewRuler: true,
      minimap: { enabled: true, renderCharacters: false, showSlider: "mouseover" },
      lineNumbersMinChars: 4,
      scrollBeyondLastLine: false,
    });
    installInlineDraftActions(diffEditor.getOriginalEditor(), "original");
    installInlineDraftActions(diffEditor.getModifiedEditor(), "modified");
  }
  cleanupEditorListeners();
  installInlineDraftActions(diffEditor.getOriginalEditor(), "original");
  installInlineDraftActions(diffEditor.getModifiedEditor(), "modified");

  if (originalModel) originalModel.dispose();
  if (modifiedModel) modifiedModel.dispose();

  const language = inferLanguage(data?.path || state.activePath, data?.language);
  originalModel = monacoApi.editor.createModel(data?.originalContent || "", language);
  modifiedModel = monacoApi.editor.createModel(data?.modifiedContent || "", language);
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  applyEditorOptions();
  refreshDecorations();
}

async function sendBridgeAction(payload) {
  try {
    if (typeof window.piDiffReviewSend === "function") {
      window.piDiffReviewSend(JSON.stringify(payload));
    } else if (window.glimpse?.send) {
      window.glimpse.send(payload);
    } else {
      throw new Error("Bridge binding is not available in this review window.");
    }
    showToast("Sent", payload.type || "Action sent to bridge.", 1500);
    if (payload.type !== "review.batch.submit") {
      setTimeout(() => refreshSession({ quiet: true }), 250);
    }
  } catch (error) {
    console.error(error);
    showToast("Send failed", error instanceof Error ? error.message : String(error), 5000);
  }
}

async function submitDraftBatch() {
  if (!state.drafts.length) return;
  const drafts = state.drafts.map((draft) => ({ ...draft }));
  await sendBridgeAction({
    type: "review.batch.submit",
    sessionId: state.sessionPayload?.session?.id || null,
    roundId: currentRound()?.id || null,
    mode: state.activeMode,
    drafts,
  });
  state.drafts = [];
  renderDrafts();
  renderNavigator();
  refreshDecorations();
  setTimeout(() => refreshSession({ quiet: true }), 250);
}

function receiveBridgeMessage(raw) {
  let message = raw;
  if (typeof raw === "string") {
    try { message = JSON.parse(raw); } catch { message = { type: "toast", title: "Bridge", message: raw }; }
  }
  if (!message || typeof message !== "object") return;
  if (message.type === "round.ready") {
    state.unreadRoundReady = true;
    updateTopBar();
    showToast("New round ready", message.summary || "The implementing agent requested re-review.", 6000);
    refreshSession({ quiet: true });
    return;
  }
  if (message.type === "session.updated") {
    if (message.unreadRoundReady) state.unreadRoundReady = true;
    updateTopBar();
    showToast(message.title || "Session updated", message.summary || "Review state changed.", 3500);
    refreshSession({ quiet: true });
    return;
  }
  if (message.type === "toast") {
    showToast(message.title || "Bridge", message.message || message.text || "", 4500);
    return;
  }
  if (message.type === "thread.updated") {
    showToast("Thread updated", message.summary || "A thread changed.", 3500);
    refreshSession({ quiet: true });
    return;
  }
  showToast("Bridge", message.summary || message.message || JSON.stringify(message), 4500);
}

window.__piDiffReviewReceive = receiveBridgeMessage;
window.__diffReviewReceive = receiveBridgeMessage;

function focusRelatedThreads() {
  const activePath = state.activePath;
  const thread = allThreads().find((item) => item.path === activePath && (item.status !== "accepted" || item.stale))
    || allThreads().find((item) => item.status !== "accepted" || item.stale);
  if (thread) focusThread(thread.id);
}

function setMode(mode) {
  if (!mode || mode === state.activeMode) return;
  state.activeMode = mode;
  state.activeFileData = null;
  state.unreadRoundReady = false;
  updateModeButtons();
  updateTopBar();
  renderNavigator();
  openFile(state.activePath || currentFiles()[0]?.path || null);
}

function toggleReviewed() {
  if (!state.activePath) return;
  if (state.reviewedPaths.has(state.activePath)) state.reviewedPaths.delete(state.activePath);
  else state.reviewedPaths.add(state.activePath);
  renderNavigator();
  updateFileHeader();
  sendBridgeAction({ type: "review.file.reviewed", path: state.activePath, reviewed: state.reviewedPaths.has(state.activePath) });
}

function bindEvents() {
  dom.refreshButton.addEventListener("click", () => refreshSession());
  dom.submitBatchButton.addEventListener("click", () => submitDraftBatch());
  dom.submitDraftsInlineButton.addEventListener("click", () => submitDraftBatch());
  dom.clearDraftsButton.addEventListener("click", () => {
    state.drafts = [];
    renderDrafts();
    renderNavigator();
    refreshDecorations();
  });
  dom.addFileCommentButton.addEventListener("click", () => {
    if (!state.activePath) return;
    createDraft({
      kind: "file",
      path: state.activePath,
      mode: state.activeMode,
      roundId: currentRound()?.id || null,
      side: "file",
      startLine: null,
      endLine: null,
      body: "",
    });
  });
  dom.toggleReviewedButton.addEventListener("click", () => toggleReviewed());
  dom.toggleWrapButton.addEventListener("click", () => {
    state.wrapLines = !state.wrapLines;
    dom.toggleWrapButton.textContent = `Wrap: ${state.wrapLines ? "on" : "off"}`;
    applyEditorOptions();
  });
  dom.toggleUnchangedButton.addEventListener("click", () => {
    state.hideUnchanged = !state.hideUnchanged;
    dom.toggleUnchangedButton.textContent = state.hideUnchanged ? "Show all lines" : "Hide unchanged";
    applyEditorOptions();
  });
  dom.openRelatedThreadsButton.addEventListener("click", () => focusRelatedThreads());
  dom.fileSearch.addEventListener("input", () => renderNavigator());
  dom.threadSearch.addEventListener("input", () => renderThreads());
  for (const button of dom.modeButtons) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
}

async function bootstrap() {
  bindEvents();
  updateModeButtons();
  updateSubmitButtons();
  await refreshSession({ quiet: true });
}

bootstrap();
