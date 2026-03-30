(function() {
  "use strict";

  // Prevent double-injection
  if (document.getElementById("pi-annotator-root")) return;

  // ---------------------------------------------------------------------------
  // Shadow DOM container
  // ---------------------------------------------------------------------------

  const host = document.createElement("div");
  host.id = "pi-annotator-root";
  host.style.cssText = "all:initial; position:fixed; z-index:2147483647;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

    .pi-toolbar {
      position: fixed; bottom: 16px; right: 16px;
      background: #1a1a2e; color: #e0e0e0; border-radius: 8px;
      padding: 8px 14px; display: flex; align-items: center; gap: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4); cursor: move;
      user-select: none; font-size: 13px; transition: opacity 0.2s;
    }
    .pi-toolbar.minimized { padding: 6px 10px; }
    .pi-toolbar.minimized .pi-toolbar-label { display: none; }

    .pi-status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #4ade80; flex-shrink: 0;
    }

    .pi-toolbar-label { font-weight: 600; font-size: 12px; letter-spacing: 0.5px; }

    .pi-badge {
      background: #f43f5e; color: white; border-radius: 10px;
      padding: 1px 6px; font-size: 11px; font-weight: 600;
      display: none;
    }
    .pi-badge.has-count { display: inline; }

    .pi-minimize-btn {
      background: none; border: none; color: #888; cursor: pointer;
      font-size: 14px; padding: 0 2px; line-height: 1;
    }
    .pi-minimize-btn:hover { color: #e0e0e0; }

    .pi-popover {
      position: fixed; background: #1a1a2e; color: #e0e0e0;
      border-radius: 10px; padding: 14px; width: 340px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: none;
      font-size: 13px; z-index: 2147483647;
    }
    .pi-popover.visible { display: block; }

    .pi-popover-selection {
      background: #2a2a4a; padding: 8px 10px; border-radius: 6px;
      font-size: 12px; color: #a0a0c0; margin-bottom: 10px;
      max-height: 60px; overflow: hidden; line-height: 1.4;
      border-left: 3px solid #6366f1;
    }

    .pi-popover textarea {
      width: 100%; height: 72px; background: #12122a; color: #e0e0e0;
      border: 1px solid #333; border-radius: 6px; padding: 8px;
      font-size: 13px; resize: vertical; outline: none;
      font-family: inherit;
    }
    .pi-popover textarea:focus { border-color: #6366f1; }
    .pi-popover textarea::placeholder { color: #555; }

    .pi-popover-actions {
      display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;
    }

    .pi-btn {
      padding: 6px 14px; border-radius: 6px; border: none;
      font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .pi-btn-primary {
      background: #6366f1; color: white;
    }
    .pi-btn-primary:hover { background: #5558e6; }
    .pi-btn-cancel {
      background: #2a2a4a; color: #a0a0c0;
    }
    .pi-btn-cancel:hover { background: #333360; }

    .pi-toast-container {
      position: fixed; top: 16px; right: 16px;
      display: flex; flex-direction: column; gap: 8px;
      pointer-events: none; z-index: 2147483647;
    }

    .pi-toast {
      background: #1a1a2e; color: #e0e0e0; border-radius: 8px;
      padding: 10px 14px; max-width: 360px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      pointer-events: auto; cursor: pointer;
      animation: pi-slide-in 0.3s ease-out;
      font-size: 13px; border-left: 3px solid #6366f1;
    }

    .pi-toast-from { font-weight: 600; font-size: 11px; color: #6366f1; margin-bottom: 4px; }
    .pi-toast-text { line-height: 1.4; }
    .pi-toast.error { border-left-color: #f43f5e; }
    .pi-toast.error .pi-toast-from { color: #f43f5e; }

    @keyframes pi-slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  shadow.appendChild(style);

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------

  const toolbar = document.createElement("div");
  toolbar.className = "pi-toolbar";
  toolbar.innerHTML = `
    <span class="pi-status-dot"></span>
    <span class="pi-toolbar-label">π Annotate</span>
    <span class="pi-badge" id="pi-badge">0</span>
    <button class="pi-minimize-btn" id="pi-minimize">−</button>
  `;
  shadow.appendChild(toolbar);

  // Drag support
  let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
  toolbar.addEventListener("mousedown", function(e) {
    if (e.target.tagName === "BUTTON") return;
    isDragging = true;
    const rect = toolbar.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  });
  document.addEventListener("mousemove", function(e) {
    if (!isDragging) return;
    toolbar.style.left = (e.clientX - dragOffsetX) + "px";
    toolbar.style.top = (e.clientY - dragOffsetY) + "px";
    toolbar.style.right = "auto";
    toolbar.style.bottom = "auto";
  });
  document.addEventListener("mouseup", function() { isDragging = false; });

  // Minimize
  const minimizeBtn = shadow.getElementById("pi-minimize");
  minimizeBtn.addEventListener("click", function() {
    toolbar.classList.toggle("minimized");
    minimizeBtn.textContent = toolbar.classList.contains("minimized") ? "+" : "−";
  });

  // ---------------------------------------------------------------------------
  // Popover
  // ---------------------------------------------------------------------------

  const popover = document.createElement("div");
  popover.className = "pi-popover";
  popover.innerHTML = `
    <div class="pi-popover-selection" id="pi-selection-preview"></div>
    <textarea id="pi-comment" placeholder="Your annotation comment..."></textarea>
    <div class="pi-popover-actions">
      <button class="pi-btn pi-btn-cancel" id="pi-cancel">Cancel</button>
      <button class="pi-btn pi-btn-primary" id="pi-send">Send</button>
    </div>
  `;
  shadow.appendChild(popover);

  let currentSelection = null;

  function getCSSSelectorPath(el) {
    var parts = [];
    var node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      var tag = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(tag + "#" + node.id); break; }
      var cls = node.className && typeof node.className === "string"
        ? "." + node.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
      parts.unshift(tag + cls);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function getSurroundingText(node, maxChars) {
    if (!node) return "";
    var block = node;
    while (block && block.nodeType !== 1) block = block.parentElement;
    if (!block) return "";
    // Walk up to nearest block-level element
    var blockTags = new Set(["P", "DIV", "SECTION", "ARTICLE", "LI", "TD", "BLOCKQUOTE", "PRE", "MAIN"]);
    while (block.parentElement && !blockTags.has(block.tagName)) block = block.parentElement;
    var text = (block.innerText || "").trim();
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }

  function getNearestHeadings(el) {
    var headings = [];
    // Walk previous siblings and parents to find heading context
    var node = el;
    while (node && node !== document.body) {
      // Check previous siblings for headings
      var sib = node.previousElementSibling;
      while (sib) {
        if (/^H[1-6]$/.test(sib.tagName)) {
          headings.unshift(sib.innerText.trim().slice(0, 80));
          break;
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return headings.slice(-3); // Last 3 heading levels
  }

  // Text selection listener
  document.addEventListener("mouseup", function(e) {
    // Ignore events from our own UI
    if (host.contains(e.target)) return;

    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }

    var text = sel.toString().trim();
    if (text.length < 3) return;

    var range = sel.getRangeAt(0);
    var container = range.commonAncestorContainer;
    var element = container.nodeType === 1 ? container : container.parentElement;

    currentSelection = {
      selectedText: text.slice(0, 1000),
      surroundingText: getSurroundingText(container, 400),
      cssSelector: getCSSSelectorPath(element),
      nearestHeadings: getNearestHeadings(element),
      elementSnippet: element ? element.outerHTML.slice(0, 500) : "",
      url: location.href,
      pageTitle: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };

    // Position popover near selection
    var rect = range.getBoundingClientRect();
    var popLeft = Math.min(rect.left, window.innerWidth - 360);
    var popTop = rect.bottom + 8;
    if (popTop + 200 > window.innerHeight) {
      popTop = rect.top - 200;
    }

    popover.style.left = Math.max(8, popLeft) + "px";
    popover.style.top = Math.max(8, popTop) + "px";

    var preview = shadow.getElementById("pi-selection-preview");
    preview.textContent = text.length > 120 ? text.slice(0, 117) + "..." : text;

    var textarea = shadow.getElementById("pi-comment");
    textarea.value = "";

    popover.classList.add("visible");
    setTimeout(function() { textarea.focus(); }, 50);
  });

  // Cancel
  shadow.getElementById("pi-cancel").addEventListener("click", function() {
    popover.classList.remove("visible");
    currentSelection = null;
  });

  // Send
  shadow.getElementById("pi-send").addEventListener("click", function() {
    var comment = shadow.getElementById("pi-comment").value.trim();
    if (!comment || !currentSelection) return;

    currentSelection.comment = comment;

    // Call the CDP binding
    if (typeof window.piAnnotate === "function") {
      window.piAnnotate(JSON.stringify(currentSelection));
    } else {
      console.error("[pi-annotator] piAnnotate binding not available");
    }

    popover.classList.remove("visible");
    currentSelection = null;
  });

  // Escape to close popover
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && popover.classList.contains("visible")) {
      popover.classList.remove("visible");
      currentSelection = null;
    }
  });

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------

  const toastContainer = document.createElement("div");
  toastContainer.className = "pi-toast-container";
  shadow.appendChild(toastContainer);

  var messageCount = 0;
  var badge = shadow.getElementById("pi-badge");

  function showToast(data) {
    var toast = document.createElement("div");
    toast.className = "pi-toast" + (data.type === "error" ? " error" : "");

    var fromText = data.from || (data.type === "error" ? "Error" : "Bridge");
    toast.innerHTML =
      '<div class="pi-toast-from">' + escapeHtml(fromText) + '</div>' +
      '<div class="pi-toast-text">' + escapeHtml((data.text || "").slice(0, 300)) + '</div>';

    toastContainer.appendChild(toast);

    // Update badge
    if (data.type === "response") {
      messageCount++;
      badge.textContent = String(messageCount);
      badge.classList.add("has-count");
    }

    // Click to expand (log full text)
    toast.addEventListener("click", function() {
      console.log("[pi-annotator] Full message from " + fromText + ":\n" + (data.text || ""));
    });

    // Auto-dismiss
    setTimeout(function() {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s";
      setTimeout(function() { toast.remove(); }, 300);
    }, 8000);
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Response handler — called by bridge via Runtime.evaluate
  // ---------------------------------------------------------------------------

  window.__piAnnotatorResponse = function(jsonString) {
    try {
      var data = JSON.parse(jsonString);
      showToast(data);
    } catch (err) {
      console.error("[pi-annotator] Invalid response:", err);
    }
  };

  console.log("[pi-annotator] Ready — select text to annotate");
})();
