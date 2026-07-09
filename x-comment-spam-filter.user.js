// ==UserScript==
// @name         XGuard 推特评论净化器
// @namespace    https://github.com/codertesla/XGuard-Reply-Filter
// @version      1.5.0
// @description  按显示名关键词、评论内容关键词批量隐藏 X/Twitter 评论区垃圾回复。
// @author       sos
// @license      MIT
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @icon64       https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main/assets/x-icon-64.png
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEY = "xCommentSpamFilter.settings";
  const SCANNED_ATTR = "data-xcsf-scanned";
  const HIDDEN_ATTR = "data-xcsf-hidden";
  const MAIN_TWEET_ATTR = "data-xcsf-main-tweet";
  const REASON_ATTR = "data-xcsf-reason";
  const REASON_TYPE_ATTR = "data-xcsf-reason-type";
  const DEFAULT_RAW_BASE = "https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main";

  const DEFAULT_SETTINGS = {
    enabled: true,
    hideMode: "remove", // "remove" or "placeholder"
    skipMainTweetOnStatusPage: true,
    remoteRulesEnabled: true,
    remoteUpdateIntervalHours: 12,
    blockedNameKeywords: [],
    blockedTextKeywords: [],
    remoteNameKeywordUrls: [
      `${DEFAULT_RAW_BASE}/lists/name-keywords.txt`,
    ],
    remoteTextKeywordUrls: [
      `${DEFAULT_RAW_BASE}/lists/comment-keywords.txt`,
    ],
    remoteCache: {
      updatedAt: 0,
      failedAt: 0,
      error: "",
      blockedNameKeywords: [],
      blockedTextKeywords: [],
    },
  };

  const PLACEHOLDER_TEXT = "已由 XGuard 推特评论净化器隐藏";
  const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060\u180E]/g;
  let settings = loadSettings();
  let effectiveRules = buildEffectiveRules(settings);
  let compiledRules = compileRules(effectiveRules, settings);
  let scanTimer = 0;
  let pendingArticles = new Set();
  let fullScanRequested = false;
  let currentPath = location.pathname;
  let currentMainTweetArticle = null;
  let activePanel = null;
  let lastFocusedElement = null;
  let sessionStats = createEmptySessionStats();
  let remoteRefreshPromise = null;
  let lastRemoteCheckAt = 0;

  addStyle();
  registerMenu();
  refreshRemoteRulesIfNeeded();
  scanSoon({ full: true });
  observePage();

  function loadSettings() {
    const saved = GM_getValue(STORE_KEY, null);
    if (!saved) return normalizeSettings(DEFAULT_SETTINGS);

    try {
      return normalizeSettings({
        ...DEFAULT_SETTINGS,
        ...JSON.parse(saved),
      });
    } catch {
      return normalizeSettings(DEFAULT_SETTINGS);
    }
  }

  function normalizeSettings(value) {
    const remoteCacheSource = value.remoteCache || {};
    // 旧版 @用户名 字段在迁移时直接丢弃，不再读写。
    const remoteCache = {
      updatedAt: Number(remoteCacheSource.updatedAt) || 0,
      failedAt: Number(remoteCacheSource.failedAt) || 0,
      error: String(remoteCacheSource.error || ""),
      blockedNameKeywords: normalizeList(remoteCacheSource.blockedNameKeywords),
      blockedTextKeywords: normalizeList(remoteCacheSource.blockedTextKeywords),
    };

    return {
      enabled: value.enabled !== false,
      hideMode: value.hideMode === "placeholder" ? "placeholder" : "remove",
      skipMainTweetOnStatusPage: value.skipMainTweetOnStatusPage !== false,
      remoteRulesEnabled: value.remoteRulesEnabled !== false,
      remoteUpdateIntervalHours: Number(value.remoteUpdateIntervalHours) || DEFAULT_SETTINGS.remoteUpdateIntervalHours,
      blockedNameKeywords: normalizeList(value.blockedNameKeywords),
      blockedTextKeywords: normalizeList(value.blockedTextKeywords),
      remoteNameKeywordUrls: Array.isArray(value.remoteNameKeywordUrls)
        ? normalizeList(value.remoteNameKeywordUrls)
        : [...DEFAULT_SETTINGS.remoteNameKeywordUrls],
      remoteTextKeywordUrls: Array.isArray(value.remoteTextKeywordUrls)
        ? normalizeList(value.remoteTextKeywordUrls)
        : [...DEFAULT_SETTINGS.remoteTextKeywordUrls],
      remoteCache,
    };
  }

  function buildEffectiveRules(value) {
    const remoteCache = value.remoteRulesEnabled ? value.remoteCache : DEFAULT_SETTINGS.remoteCache;
    return {
      blockedNameKeywords: uniqueList([
        ...normalizeList(value.blockedNameKeywords),
        ...normalizeList(remoteCache.blockedNameKeywords),
      ]),
      blockedTextKeywords: uniqueList([
        ...normalizeList(value.blockedTextKeywords),
        ...normalizeList(remoteCache.blockedTextKeywords),
      ]),
    };
  }

  function compileRules(rules, value) {
    const blockedNameKeywords = compileKeywords(rules.blockedNameKeywords);
    const blockedTextKeywords = compileKeywords(rules.blockedTextKeywords);
    const signature = [
      value.enabled,
      value.hideMode,
      value.skipMainTweetOnStatusPage,
      value.remoteRulesEnabled,
      value.remoteCache?.updatedAt || 0,
      blockedNameKeywords.map((item) => item.normalized).join("|"),
      blockedTextKeywords.map((item) => item.normalized).join("|"),
    ].join("::");

    return {
      blockedNameKeywords,
      blockedTextKeywords,
      signature,
    };
  }

  function compileKeywords(items) {
    const seen = new Set();
    const result = [];

    for (const raw of normalizeList(items)) {
      const normalized = normalizeText(raw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push({
        raw,
        normalized,
        compact: compactText(normalized),
      });
    }

    // 更长关键词优先，命中原因更具体，也减少短词抢先匹配。
    result.sort((a, b) => b.normalized.length - a.normalized.length || a.normalized.localeCompare(b.normalized));
    return result;
  }

  function uniqueList(items) {
    const seen = new Set();
    const result = [];

    for (const item of normalizeList(items)) {
      const key = normalizeText(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }

    return result;
  }

  function saveSettings(nextSettings = settings) {
    settings = normalizeSettings(nextSettings);
    effectiveRules = buildEffectiveRules(settings);
    compiledRules = compileRules(effectiveRules, settings);
    GM_setValue(STORE_KEY, JSON.stringify(settings));
    resetScannedState();
    scanSoon({ full: true });
  }

  function registerMenu() {
    GM_registerMenuCommand("打开过滤设置", openSettingsPanel);
    GM_registerMenuCommand("查看过滤统计", showStatsSummary);

    GM_registerMenuCommand("启用/停用过滤", () => {
      const enabled = !settings.enabled;
      saveSettings({ ...settings, enabled });
      alert(`XGuard 推特评论净化器：已${enabled ? "启用" : "停用"}`);
    });

    GM_registerMenuCommand("切换隐藏模式", () => {
      const hideMode = settings.hideMode === "remove" ? "placeholder" : "remove";
      saveSettings({ ...settings, hideMode });
      alert(`隐藏模式：${hideMode === "remove" ? "直接隐藏" : "显示占位提示"}`);
    });

    GM_registerMenuCommand("立即更新远程规则", async () => {
      await refreshRemoteRules({ force: true, notify: true });
    });

    GM_registerMenuCommand("恢复默认规则", () => {
      if (confirm("确定要恢复默认过滤规则吗？")) {
        saveSettings({ ...DEFAULT_SETTINGS });
      }
    });
  }

  function showStatsSummary() {
    clearTimeout(scanTimer);
    fullScanRequested = true;
    scanPendingArticles();
    const pageStats = collectPageStats();
    const ruleCount = compiledRules.blockedNameKeywords.length
      + compiledRules.blockedTextKeywords.length;

    alert([
      "XGuard 过滤统计",
      "",
      `当前页隐藏：${pageStats.total}（${formatHitBreakdown(pageStats.byType)}）`,
      `本次会话命中：${sessionStats.hidden}（${formatHitBreakdown(sessionStats.byType)}）`,
      `启用规则：${ruleCount}（显示名 ${compiledRules.blockedNameKeywords.length} / 内容 ${compiledRules.blockedTextKeywords.length}）`,
      `扫描文章：${sessionStats.scanned}`,
      `跳过文章：${sessionStats.skipped}`,
      `远程状态：${formatRemoteStatus()}`,
    ].join("\n"));
  }

  function openSettingsPanel() {
    document.querySelector(".xcsf-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "xcsf-overlay";
    overlay.innerHTML = `
      <div class="xcsf-panel" role="dialog" aria-modal="true" aria-label="XGuard 推特评论净化器设置">
        <div class="xcsf-header">
          <div>
            <div class="xcsf-title">XGuard 推特评论净化器</div>
            <div class="xcsf-subtitle">按显示名 / 评论关键词批量过滤；本地规则每行一条，远程订阅可配置多个 URL。</div>
          </div>
          <button class="xcsf-icon-button" type="button" data-action="close" aria-label="关闭">×</button>
        </div>

        <div class="xcsf-controls">
          <label class="xcsf-check">
            <input type="checkbox" data-field="enabled">
            <span>启用过滤</span>
          </label>
          <label class="xcsf-check">
            <input type="checkbox" data-field="skipMainTweetOnStatusPage">
            <span>推文详情页不处理第一条主推文</span>
          </label>
          <label class="xcsf-check">
            <input type="checkbox" data-field="remoteRulesEnabled">
            <span>启用远程订阅规则</span>
          </label>
          <label class="xcsf-select-label">
            <span>隐藏模式</span>
            <select data-field="hideMode">
              <option value="remove">直接隐藏</option>
              <option value="placeholder">显示占位提示，可点击临时展开</option>
            </select>
          </label>
          <label class="xcsf-select-label">
            <span>自动更新间隔</span>
            <select data-field="remoteUpdateIntervalHours">
              <option value="6">每 6 小时</option>
              <option value="12">每 12 小时</option>
              <option value="24">每天</option>
              <option value="168">每周</option>
            </select>
          </label>
        </div>

        <div class="xcsf-status">
          <span data-field="remoteStatus" aria-live="polite"></span>
          <div class="xcsf-status-actions">
            <button type="button" data-action="dedupe-local">清理重复本地规则</button>
            <button type="button" data-action="update-remote">立即更新</button>
          </div>
        </div>

        <div class="xcsf-stats" aria-live="polite">
          <div>
            <strong data-field="pageHiddenCount">0</strong>
            <span>当前页隐藏</span>
            <small data-field="pageBreakdown"></small>
          </div>
          <div>
            <strong data-field="sessionHiddenCount">0</strong>
            <span>本次会话命中</span>
            <small data-field="sessionBreakdown"></small>
          </div>
          <div>
            <strong data-field="ruleCount">0</strong>
            <span>启用规则</span>
            <small data-field="ruleBreakdown"></small>
          </div>
        </div>

        <label class="xcsf-field">
          <span>本地屏蔽显示名关键词</span>
          <textarea data-field="blockedNameKeywords" spellcheck="false" placeholder="线下&#10;上门&#10;点击主页"></textarea>
        </label>

        <label class="xcsf-field">
          <span>本地屏蔽评论内容关键词</span>
          <textarea data-field="blockedTextKeywords" spellcheck="false" placeholder="telegram&#10;whatsapp&#10;领空投"></textarea>
        </label>

        <details class="xcsf-json" open>
          <summary>远程关键词订阅 URL</summary>
          <label class="xcsf-field xcsf-nested-field">
            <span>远程显示名关键词列表 URL</span>
            <textarea data-field="remoteNameKeywordUrls" spellcheck="false" rows="2"></textarea>
          </label>
          <label class="xcsf-field xcsf-nested-field">
            <span>远程评论关键词列表 URL</span>
            <textarea data-field="remoteTextKeywordUrls" spellcheck="false" rows="2"></textarea>
          </label>
        </details>

        <details class="xcsf-json">
          <summary>导入 / 导出完整规则 JSON</summary>
          <textarea data-field="jsonRules" spellcheck="false"></textarea>
          <div class="xcsf-row">
            <button type="button" data-action="refresh-json">刷新导出内容</button>
            <button type="button" data-action="import-json">从 JSON 导入</button>
          </div>
        </details>

        <div class="xcsf-footer">
          <button type="button" data-action="reset">恢复默认</button>
          <span class="xcsf-dirty" data-field="dirtyNotice" hidden>有未保存更改</span>
          <div class="xcsf-footer-main">
            <button type="button" data-action="close">取消</button>
            <button type="button" data-action="save" class="xcsf-primary">保存规则</button>
          </div>
        </div>
      </div>
    `;

    document.documentElement.append(overlay);
    activePanel = overlay;
    lastFocusedElement = document.activeElement;

    const fields = getPanelFields(overlay);
    fields.enabled.checked = settings.enabled;
    fields.skipMainTweetOnStatusPage.checked = settings.skipMainTweetOnStatusPage;
    fields.remoteRulesEnabled.checked = settings.remoteRulesEnabled;
    fields.hideMode.value = settings.hideMode;
    fields.remoteUpdateIntervalHours.value = String(settings.remoteUpdateIntervalHours);
    fields.blockedNameKeywords.value = normalizeList(settings.blockedNameKeywords).join("\n");
    fields.blockedTextKeywords.value = normalizeList(settings.blockedTextKeywords).join("\n");
    fields.remoteNameKeywordUrls.value = normalizeList(settings.remoteNameKeywordUrls).join("\n");
    fields.remoteTextKeywordUrls.value = normalizeList(settings.remoteTextKeywordUrls).join("\n");
    fields.remoteStatus.textContent = formatRemoteStatus();
    fields.jsonRules.value = JSON.stringify(settings, null, 2);
    updatePanelStats(overlay);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) requestClosePanel(overlay);
    });

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") requestClosePanel(overlay);
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        saveFromPanel(overlay);
      }
      keepFocusInPanel(event, overlay);
    });

    overlay.addEventListener("input", () => markPanelDirty(overlay));
    overlay.addEventListener("change", () => markPanelDirty(overlay));

    overlay.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "close") requestClosePanel(overlay);
      if (action === "save") saveFromPanel(overlay);
      if (action === "reset") resetPanelFields(overlay);
      if (action === "update-remote") updateRemoteFromPanel(overlay);
      if (action === "dedupe-local") dedupeLocalRulesFromPanel(overlay);
      if (action === "refresh-json") {
        getPanelFields(overlay).jsonRules.value = JSON.stringify(readSettingsFromPanel(overlay), null, 2);
      }
      if (action === "import-json") importJsonFromPanel(overlay);
    });

    fields.blockedNameKeywords.focus();
  }

  function getPanelFields(root) {
    return {
      enabled: root.querySelector('[data-field="enabled"]'),
      skipMainTweetOnStatusPage: root.querySelector('[data-field="skipMainTweetOnStatusPage"]'),
      remoteRulesEnabled: root.querySelector('[data-field="remoteRulesEnabled"]'),
      hideMode: root.querySelector('[data-field="hideMode"]'),
      remoteUpdateIntervalHours: root.querySelector('[data-field="remoteUpdateIntervalHours"]'),
      blockedNameKeywords: root.querySelector('[data-field="blockedNameKeywords"]'),
      blockedTextKeywords: root.querySelector('[data-field="blockedTextKeywords"]'),
      remoteNameKeywordUrls: root.querySelector('[data-field="remoteNameKeywordUrls"]'),
      remoteTextKeywordUrls: root.querySelector('[data-field="remoteTextKeywordUrls"]'),
      remoteStatus: root.querySelector('[data-field="remoteStatus"]'),
      jsonRules: root.querySelector('[data-field="jsonRules"]'),
      pageHiddenCount: root.querySelector('[data-field="pageHiddenCount"]'),
      sessionHiddenCount: root.querySelector('[data-field="sessionHiddenCount"]'),
      ruleCount: root.querySelector('[data-field="ruleCount"]'),
      pageBreakdown: root.querySelector('[data-field="pageBreakdown"]'),
      sessionBreakdown: root.querySelector('[data-field="sessionBreakdown"]'),
      ruleBreakdown: root.querySelector('[data-field="ruleBreakdown"]'),
      dirtyNotice: root.querySelector('[data-field="dirtyNotice"]'),
    };
  }

  function readSettingsFromPanel(root) {
    const fields = getPanelFields(root);
    return {
      ...settings,
      enabled: fields.enabled.checked,
      skipMainTweetOnStatusPage: fields.skipMainTweetOnStatusPage.checked,
      remoteRulesEnabled: fields.remoteRulesEnabled.checked,
      hideMode: fields.hideMode.value,
      remoteUpdateIntervalHours: Number(fields.remoteUpdateIntervalHours.value) || DEFAULT_SETTINGS.remoteUpdateIntervalHours,
      blockedNameKeywords: parseList(fields.blockedNameKeywords.value),
      blockedTextKeywords: parseList(fields.blockedTextKeywords.value),
      remoteNameKeywordUrls: parseList(fields.remoteNameKeywordUrls.value),
      remoteTextKeywordUrls: parseList(fields.remoteTextKeywordUrls.value),
    };
  }

  function saveFromPanel(root) {
    saveSettings(readSettingsFromPanel(root));
    closePanel(root);
  }

  function markPanelDirty(root) {
    root.dataset.dirty = "true";
    getPanelFields(root).dirtyNotice.hidden = false;
  }

  function resetPanelFields(root) {
    if (!confirm("确定要把面板中的规则恢复为默认值吗？")) return;

    const fields = getPanelFields(root);
    fields.enabled.checked = DEFAULT_SETTINGS.enabled;
    fields.skipMainTweetOnStatusPage.checked = DEFAULT_SETTINGS.skipMainTweetOnStatusPage;
    fields.remoteRulesEnabled.checked = DEFAULT_SETTINGS.remoteRulesEnabled;
    fields.hideMode.value = DEFAULT_SETTINGS.hideMode;
    fields.remoteUpdateIntervalHours.value = String(DEFAULT_SETTINGS.remoteUpdateIntervalHours);
    fields.blockedNameKeywords.value = DEFAULT_SETTINGS.blockedNameKeywords.join("\n");
    fields.blockedTextKeywords.value = DEFAULT_SETTINGS.blockedTextKeywords.join("\n");
    fields.remoteNameKeywordUrls.value = DEFAULT_SETTINGS.remoteNameKeywordUrls.join("\n");
    fields.remoteTextKeywordUrls.value = DEFAULT_SETTINGS.remoteTextKeywordUrls.join("\n");
    fields.remoteStatus.textContent = "面板已恢复默认值，保存后生效。";
    fields.jsonRules.value = JSON.stringify(DEFAULT_SETTINGS, null, 2);
    markPanelDirty(root);
  }

  function importJsonFromPanel(root) {
    const fields = getPanelFields(root);
    try {
      const imported = JSON.parse(fields.jsonRules.value);
      saveSettings({
        ...DEFAULT_SETTINGS,
        ...imported,
      });
      closePanel(root);
    } catch (error) {
      alert(`导入失败：${error.message}`);
    }
  }

  function closePanel(root) {
    root.remove();
    if (activePanel === root) activePanel = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  }

  function requestClosePanel(root) {
    if (root.dataset.dirty === "true" && !confirm("设置尚未保存，确定关闭吗？")) return;
    closePanel(root);
  }

  function keepFocusInPanel(event, root) {
    if (event.key !== "Tab") return;

    const focusable = Array.from(root.querySelectorAll([
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "summary",
      "[tabindex]:not([tabindex='-1'])",
    ].join(","))).filter((element) => element.offsetParent !== null);

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function updatePanelStats(root = activePanel) {
    if (!root || !document.contains(root)) return;

    const fields = getPanelFields(root);
    const pageStats = collectPageStats();
    const ruleCount = compiledRules.blockedNameKeywords.length
      + compiledRules.blockedTextKeywords.length;

    fields.pageHiddenCount.textContent = String(pageStats.total);
    fields.sessionHiddenCount.textContent = String(sessionStats.hidden);
    fields.ruleCount.textContent = String(ruleCount);
    fields.pageBreakdown.textContent = formatHitBreakdown(pageStats.byType);
    fields.sessionBreakdown.textContent = formatHitBreakdown(sessionStats.byType);
    fields.ruleBreakdown.textContent = `显示名 ${compiledRules.blockedNameKeywords.length} / 内容 ${compiledRules.blockedTextKeywords.length}`;
  }

  function formatHitBreakdown(byType) {
    return `显示名 ${byType.name} / 内容 ${byType.text}`;
  }

  async function updateRemoteFromPanel(root) {
    const fields = getPanelFields(root);
    saveSettings(readSettingsFromPanel(root));
    root.dataset.dirty = "false";
    fields.dirtyNotice.hidden = true;
    fields.remoteStatus.textContent = "正在更新远程规则...";
    await refreshRemoteRules({ force: true, notify: false });
    if (document.contains(root)) {
      fields.remoteStatus.textContent = formatRemoteStatus();
      fields.jsonRules.value = JSON.stringify(settings, null, 2);
      updatePanelStats(root);
    }
  }

  function dedupeLocalRulesFromPanel(root) {
    const fields = getPanelFields(root);
    const cache = settings.remoteCache || DEFAULT_SETTINGS.remoteCache;
    const result = {
      names: removeDuplicates(parseList(fields.blockedNameKeywords.value), cache.blockedNameKeywords),
      texts: removeDuplicates(parseList(fields.blockedTextKeywords.value), cache.blockedTextKeywords),
    };
    const removedCount = result.names.removed + result.texts.removed;

    fields.blockedNameKeywords.value = result.names.items.join("\n");
    fields.blockedTextKeywords.value = result.texts.items.join("\n");
    fields.jsonRules.value = JSON.stringify(readSettingsFromPanel(root), null, 2);
    markPanelDirty(root);

    if (removedCount) {
      fields.remoteStatus.textContent = `已移除 ${removedCount} 条与远程缓存重复的本地规则，点击“保存规则”后生效。`;
    } else {
      fields.remoteStatus.textContent = "未发现与远程缓存重复的本地规则。";
    }
  }

  function removeDuplicates(localItems, remoteItems) {
    const remoteSet = new Set(normalizeList(remoteItems).map(normalizeText));
    const items = [];
    let removed = 0;

    for (const item of normalizeList(localItems)) {
      if (remoteSet.has(normalizeText(item))) {
        removed += 1;
        continue;
      }
      items.push(item);
    }

    return { items, removed };
  }

  function parseList(value) {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseRemoteList(value) {
    return uniqueList(String(value)
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+#.*$/, "").trim())
      .filter((line) => line && !line.startsWith("#")));
  }

  function normalizeList(value) {
    return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
  }

  async function refreshRemoteRulesIfNeeded({ forceCheck = false } = {}) {
    if (!settings.remoteRulesEnabled) return;
    const now = Date.now();
    if (!forceCheck && now - lastRemoteCheckAt < 60 * 1000) return;
    lastRemoteCheckAt = now;

    const intervalMs = settings.remoteUpdateIntervalHours * 60 * 60 * 1000;
    const updatedAt = Number(settings.remoteCache?.updatedAt) || 0;
    const failedAt = Number(settings.remoteCache?.failedAt) || 0;
    const retryMs = Math.min(intervalMs, 30 * 60 * 1000);

    // 成功缓存未过期则跳过；若上次全失败，则按较短间隔重试。
    if (updatedAt && now - updatedAt < intervalMs) {
      if (!failedAt || now - failedAt < retryMs) return;
    } else if (!updatedAt && failedAt && now - failedAt < retryMs) {
      return;
    }

    await refreshRemoteRules({ force: false, notify: false });
  }

  async function refreshRemoteRules({ force = false, notify = false } = {}) {
    if (!settings.remoteRulesEnabled && !force) return;
    if (remoteRefreshPromise) return remoteRefreshPromise;

    remoteRefreshPromise = (async () => {
      const cache = settings.remoteCache || DEFAULT_SETTINGS.remoteCache;
      const [namesResult, textsResult] = await Promise.all([
        fetchRemoteLists(settings.remoteNameKeywordUrls, cache.blockedNameKeywords),
        fetchRemoteLists(settings.remoteTextKeywordUrls, cache.blockedTextKeywords),
      ]);
      const results = [namesResult, textsResult];
      const errors = results.flatMap((result) => result.errors);
      const attempted = results.filter((result) => result.attempted);
      const anySuccess = attempted.some((result) => result.ok);

      if (!attempted.length) {
        if (notify) alert("未配置任何远程订阅 URL。");
        return;
      }

      if (!anySuccess) {
        saveSettings({
          ...settings,
          remoteCache: {
            ...cache,
            failedAt: Date.now(),
            error: errors.join("；") || "远程规则更新失败",
          },
        });
        if (notify) {
          alert(`远程规则更新失败，已保留上次缓存。\n${errors.join("；")}`);
        }
        return;
      }

      saveSettings({
        ...settings,
        remoteCache: {
          updatedAt: Date.now(),
          failedAt: errors.length ? Date.now() : 0,
          error: errors.join("；"),
          blockedNameKeywords: namesResult.items,
          blockedTextKeywords: textsResult.items,
        },
      });

      if (notify) {
        const message = `远程规则已更新：显示名关键词 ${namesResult.items.length} 条，评论关键词 ${textsResult.items.length} 条。`;
        alert(errors.length ? `${message}\n部分订阅失败：${errors.join("；")}` : message);
      }
    })();

    try {
      await remoteRefreshPromise;
    } finally {
      remoteRefreshPromise = null;
    }
  }

  async function fetchRemoteLists(urls, fallbackItems = []) {
    const cleanUrls = uniqueList(urls);
    if (!cleanUrls.length) {
      return {
        items: uniqueList(fallbackItems),
        errors: [],
        attempted: false,
        ok: false,
      };
    }

    const results = await Promise.allSettled(cleanUrls.map(fetchText));
    const responses = [];
    const errors = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        responses.push(result.value);
      } else {
        errors.push(`${cleanUrls[index]}：${result.reason?.message || result.reason}`);
      }
    });

    if (!responses.length) {
      return {
        items: uniqueList(fallbackItems),
        errors,
        attempted: true,
        ok: false,
      };
    }

    return {
      items: uniqueList(responses.flatMap(parseRemoteList)),
      errors,
      attempted: true,
      ok: true,
    };
  }

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: withCacheBuster(url),
        timeout: 15000,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText || "");
            return;
          }
          reject(new Error(`${url} 返回 HTTP ${response.status}`));
        },
        onerror: () => reject(new Error(`${url} 请求失败`)),
        ontimeout: () => reject(new Error(`${url} 请求超时`)),
      });
    });
  }

  function withCacheBuster(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}_xguard=${Date.now()}`;
  }

  function formatRemoteStatus() {
    const cache = settings.remoteCache || DEFAULT_SETTINGS.remoteCache;
    const updatedAt = Number(cache.updatedAt) || 0;
    const failedAt = Number(cache.failedAt) || 0;
    const counts = [
      `显示名关键词 ${normalizeList(cache.blockedNameKeywords).length} 条`,
      `评论关键词 ${normalizeList(cache.blockedTextKeywords).length} 条`,
    ].join("，");

    if (!settings.remoteRulesEnabled) return `远程订阅已停用。缓存：${counts}`;
    if (cache.error && failedAt && !updatedAt) return `上次更新失败：${cache.error}。当前缓存：${counts}`;
    if (cache.error && failedAt && updatedAt) return `部分订阅失败：${cache.error}。当前缓存：${counts}`;
    if (!updatedAt) return `尚未成功更新远程规则。当前缓存：${counts}`;
    return `远程规则上次更新：${new Date(updatedAt).toLocaleString()}。缓存：${counts}`;
  }

  function observePage() {
    const observer = new MutationObserver((mutations) => {
      if (location.pathname !== currentPath) {
        currentPath = location.pathname;
        currentMainTweetArticle = null;
        resetScannedState();
        sessionStats = createEmptySessionStats();
        refreshRemoteRulesIfNeeded();
        scanSoon({ full: true });
        return;
      }

      const articles = [];
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          articles.push(...collectArticlesFromNode(node));
        }
      }

      if (articles.length) scanSoon({ articles });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // X 是 SPA，部分路由切换不一定触发足够的 DOM mutation；定期兜底检查。
    window.setInterval(() => {
      if (location.pathname !== currentPath) {
        currentPath = location.pathname;
        currentMainTweetArticle = null;
        resetScannedState();
        sessionStats = createEmptySessionStats();
        refreshRemoteRulesIfNeeded();
        scanSoon({ full: true });
        return;
      }
      refreshRemoteRulesIfNeeded();
    }, 1500);
  }

  function scanSoon({ articles = [], full = false } = {}) {
    if (full) fullScanRequested = true;
    for (const article of articles) pendingArticles.add(article);

    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanPendingArticles, 120);
  }

  function scanPendingArticles() {
    if (!settings.enabled) {
      restoreHiddenArticles();
      pendingArticles.clear();
      fullScanRequested = false;
      updatePanelStats();
      return;
    }

    const mainTweetChanged = markMainTweet();
    if (mainTweetChanged) resetScannedState();

    const signature = currentScanSignature();
    const articles = fullScanRequested || mainTweetChanged
      ? Array.from(document.querySelectorAll('article[role="article"]'))
      : Array.from(pendingArticles).filter((article) => document.contains(article));

    for (const article of articles) {
      scanArticle(article, signature);
    }

    pendingArticles.clear();
    fullScanRequested = false;
    updatePanelStats();
  }

  function scanArticle(article, signature) {
    if (article.getAttribute(SCANNED_ATTR) === signature) return;
    article.setAttribute(SCANNED_ATTR, signature);
    sessionStats.scanned += 1;

    if (shouldSkipArticle(article)) {
      sessionStats.skipped += 1;
      restoreArticle(article);
      return;
    }

    const match = getBlockMatch(article);
    if (match) {
      hideArticle(article, match);
    } else {
      restoreArticle(article);
    }
  }

  function currentScanSignature() {
    return `${compiledRules.signature}::${currentPath}`;
  }

  function collectArticlesFromNode(node) {
    if (!(node instanceof Element)) return [];
    if (node.matches('article[role="article"]')) return [node];
    return Array.from(node.querySelectorAll('article[role="article"]'));
  }

  function getOwnUserNameRoot(article) {
    const roots = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));
    return roots.find((root) => root.closest('article[role="article"]') === article) || null;
  }

  function getOwnTweetTextRoot(article) {
    const roots = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    return roots.find((root) => root.closest('article[role="article"]') === article) || null;
  }

  function markMainTweet() {
    for (const article of document.querySelectorAll(`[${MAIN_TWEET_ATTR}]`)) {
      article.removeAttribute(MAIN_TWEET_ATTR);
    }

    if (!isStatusPage() || !settings.skipMainTweetOnStatusPage) {
      const changed = currentMainTweetArticle !== null;
      currentMainTweetArticle = null;
      return changed;
    }

    const statusId = getCurrentStatusId();
    const articles = Array.from(document.querySelectorAll('main article[role="article"]'))
      .filter((article) => !article.parentElement?.closest('article[role="article"]'));
    const mainArticle = articles.find((article) => articleLinksToStatus(article, statusId)) || articles[0];
    if (mainArticle) mainArticle.setAttribute(MAIN_TWEET_ATTR, "true");
    const changed = currentMainTweetArticle !== mainArticle;
    currentMainTweetArticle = mainArticle || null;
    return changed;
  }

  function isStatusPage() {
    return Boolean(getCurrentStatusId());
  }

  function getCurrentStatusId() {
    return location.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1] || "";
  }

  function articleLinksToStatus(article, statusId) {
    if (!statusId) return false;
    const links = Array.from(article.querySelectorAll(`a[href*="/status/${statusId}"]`));
    return links.some((link) => link.closest('article[role="article"]') === article);
  }

  function shouldSkipArticle(article) {
    // 引用推文等嵌套 article 由外层回复统一处理，避免误伤引用内容。
    if (article.parentElement?.closest('article[role="article"]')) return true;
    if (article.getAttribute(MAIN_TWEET_ATTR) === "true") return true;
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    return !getOwnUserNameRoot(article) && !getOwnTweetTextRoot(article);
  }

  function getBlockMatch(article) {
    const displayName = extractDisplayName(article);
    const text = normalizeText(extractTweetText(article));

    const nameKeyword = findCompiledKeyword(displayName, compiledRules.blockedNameKeywords);
    if (nameKeyword) {
      return {
        type: "name",
        text: `命中显示名关键词「${nameKeyword.raw}」`,
      };
    }

    const textKeyword = findCompiledKeyword(text, compiledRules.blockedTextKeywords);
    if (textKeyword) {
      return {
        type: "text",
        text: `命中评论关键词「${textKeyword.raw}」`,
      };
    }

    return null;
  }

  function extractDisplayName(article) {
    const userName = getOwnUserNameRoot(article);
    if (!userName) return "";

    const displayNameLink = userName.querySelector('a[href^="/"]');
    // 优先取显示名链接文本；若拿不到，再回退到 User-Name 区域，但去掉 @handle 文本。
    if (displayNameLink) return normalizeText(textWithEmojiAlt(displayNameLink));

    const raw = textWithEmojiAlt(userName);
    return normalizeText(raw.replace(/@\w{1,15}/gi, " "));
  }

  function extractTweetText(article) {
    const tweetText = getOwnTweetTextRoot(article);
    return tweetText ? textWithEmojiAlt(tweetText) : "";
  }

  function textWithEmojiAlt(root) {
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent);
        continue;
      }

      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "IMG") {
        parts.push(node.getAttribute("alt") || "");
      }
    }

    return parts.join(" ");
  }

  function normalizeText(value) {
    return String(value)
      .normalize("NFKC")
      .replace(ZERO_WIDTH_RE, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function compactText(value) {
    return normalizeText(value).replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function findCompiledKeyword(text, keywords) {
    const haystack = normalizeText(text);
    if (!haystack || !keywords.length) return null;

    const direct = keywords.find((keyword) => haystack.includes(keyword.normalized));
    if (direct) return direct;

    // 对去掉空格/标点后的文本再匹配一次，降低「领 空 投」「t.e.l.e.g.r.a.m」这类绕过。
    // 仅对长度 >= 2 的关键词启用，避免过短词误伤。
    const compactHaystack = compactText(haystack);
    if (!compactHaystack) return null;
    return keywords.find((keyword) => keyword.compact.length >= 2 && compactHaystack.includes(keyword.compact)) || null;
  }

  function hideArticle(article, match) {
    const previousReason = article.getAttribute(REASON_ATTR);
    article.setAttribute(HIDDEN_ATTR, settings.hideMode);
    article.setAttribute(REASON_ATTR, match.text);
    article.setAttribute(REASON_TYPE_ATTR, match.type);
    recordHit(match, previousReason);

    let placeholder = article.querySelector(":scope > .xcsf-placeholder");
    if (settings.hideMode === "placeholder") {
      if (!placeholder) {
        placeholder = document.createElement("button");
        placeholder.type = "button";
        placeholder.className = "xcsf-placeholder";
        placeholder.addEventListener("click", () => {
          article.setAttribute(HIDDEN_ATTR, "revealed");
        });
        article.prepend(placeholder);
      }
      placeholder.textContent = `${PLACEHOLDER_TEXT}: ${match.text}`;
      return;
    }

    if (placeholder) placeholder.remove();
  }

  function restoreArticle(article) {
    article.removeAttribute(HIDDEN_ATTR);
    article.removeAttribute(REASON_ATTR);
    article.removeAttribute(REASON_TYPE_ATTR);
    const placeholder = article.querySelector(":scope > .xcsf-placeholder");
    if (placeholder) placeholder.remove();
  }

  function restoreHiddenArticles() {
    for (const article of document.querySelectorAll(`article[${HIDDEN_ATTR}]`)) {
      restoreArticle(article);
    }
  }

  function resetScannedState() {
    for (const article of document.querySelectorAll(`article[${SCANNED_ATTR}]`)) {
      article.removeAttribute(SCANNED_ATTR);
    }
  }

  function createEmptySessionStats() {
    return {
      scanned: 0,
      skipped: 0,
      hidden: 0,
      byType: {
        name: 0,
        text: 0,
      },
      lastReason: "",
    };
  }

  function recordHit(match, previousReason) {
    if (previousReason === match.text) return;

    sessionStats.hidden += 1;
    if (Object.prototype.hasOwnProperty.call(sessionStats.byType, match.type)) {
      sessionStats.byType[match.type] += 1;
    }
    sessionStats.lastReason = match.text;
  }

  function collectPageStats() {
    const stats = {
      total: 0,
      byType: {
        name: 0,
        text: 0,
      },
    };

    for (const article of document.querySelectorAll(`article[${HIDDEN_ATTR}]`)) {
      if (article.getAttribute(HIDDEN_ATTR) === "revealed") continue;
      const type = article.getAttribute(REASON_TYPE_ATTR);
      stats.total += 1;
      if (Object.prototype.hasOwnProperty.call(stats.byType, type)) {
        stats.byType[type] += 1;
      }
    }

    return stats;
  }

  function addStyle() {
    const style = document.createElement("style");
    style.textContent = `
      article[${HIDDEN_ATTR}="remove"] {
        display: none !important;
      }

      article[${HIDDEN_ATTR}="placeholder"] > :not(.xcsf-placeholder) {
        display: none !important;
      }

      article[${HIDDEN_ATTR}="revealed"] > .xcsf-placeholder {
        display: none !important;
      }

      .xcsf-placeholder {
        display: block;
        width: 100%;
        padding: 12px 16px;
        border: 0;
        border-bottom: 1px solid rgb(47, 51, 54);
        background: transparent;
        color: rgb(113, 118, 123);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .xcsf-placeholder:hover {
        background: rgba(239, 243, 244, 0.06);
      }

      .xcsf-overlay {
        --xcsf-bg: rgb(22, 24, 28);
        --xcsf-bg-muted: rgba(255, 255, 255, 0.03);
        --xcsf-field-bg: rgb(0, 0, 0);
        --xcsf-text: rgb(231, 233, 234);
        --xcsf-muted: rgb(139, 152, 165);
        --xcsf-border: rgb(47, 51, 54);
        --xcsf-accent: rgb(29, 155, 240);
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(0, 0, 0, 0.58);
        color: var(--xcsf-text);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .xcsf-panel {
        box-sizing: border-box;
        width: min(680px, 100%);
        max-height: min(860px, calc(100vh - 40px));
        overflow: auto;
        border: 1px solid var(--xcsf-border);
        border-radius: 8px;
        background: var(--xcsf-bg);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.48);
      }

      .xcsf-header,
      .xcsf-footer {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 16px;
        border-bottom: 1px solid var(--xcsf-border);
      }

      .xcsf-footer {
        border-top: 1px solid var(--xcsf-border);
        border-bottom: 0;
      }

      .xcsf-title {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.25;
      }

      .xcsf-subtitle {
        margin-top: 4px;
        color: var(--xcsf-muted);
        font-size: 14px;
        line-height: 1.4;
      }

      .xcsf-controls,
      .xcsf-field,
      .xcsf-status,
      .xcsf-stats,
      .xcsf-json {
        display: grid;
        gap: 10px;
        margin: 16px;
      }

      .xcsf-status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--xcsf-border);
        border-radius: 6px;
        background: color-mix(in srgb, var(--xcsf-accent) 12%, transparent);
        color: var(--xcsf-muted);
        font-size: 14px;
        line-height: 1.45;
      }

      .xcsf-status > span {
        min-width: 0;
        flex: 1;
      }

      .xcsf-stats {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .xcsf-stats > div {
        display: grid;
        gap: 2px;
        padding: 10px 12px;
        border: 1px solid var(--xcsf-border);
        border-radius: 6px;
        background: var(--xcsf-bg-muted);
      }

      .xcsf-stats strong {
        color: var(--xcsf-text);
        font-size: 20px;
        line-height: 1.1;
      }

      .xcsf-stats span,
      .xcsf-stats small,
      .xcsf-dirty {
        color: var(--xcsf-muted);
        font-size: 13px;
      }

      .xcsf-stats small {
        min-height: 18px;
      }

      .xcsf-controls {
        padding: 12px;
        border: 1px solid var(--xcsf-border);
        border-radius: 8px;
        background: var(--xcsf-bg-muted);
      }

      .xcsf-check,
      .xcsf-select-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: var(--xcsf-text);
        font-size: 14px;
      }

      .xcsf-check {
        justify-content: flex-start;
      }

      .xcsf-field > span,
      .xcsf-json > summary,
      .xcsf-select-label > span {
        color: var(--xcsf-text);
        font-size: 14px;
        font-weight: 700;
      }

      .xcsf-field textarea,
      .xcsf-json textarea,
      .xcsf-select-label select {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid var(--xcsf-border);
        border-radius: 6px;
        background: var(--xcsf-field-bg);
        color: var(--xcsf-text);
        font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        outline: none;
      }

      .xcsf-field textarea:focus,
      .xcsf-json textarea:focus,
      .xcsf-select-label select:focus,
      .xcsf-panel button:focus-visible {
        border-color: var(--xcsf-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--xcsf-accent) 35%, transparent);
      }

      .xcsf-field textarea,
      .xcsf-json textarea {
        min-height: 92px;
        resize: vertical;
        padding: 10px;
      }

      .xcsf-json textarea {
        min-height: 150px;
      }

      .xcsf-select-label select {
        max-width: 280px;
        padding: 8px 10px;
      }

      .xcsf-row,
      .xcsf-footer-main,
      .xcsf-status-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .xcsf-nested-field {
        margin: 10px 0 0;
      }

      .xcsf-nested-field textarea {
        min-height: 58px;
      }

      .xcsf-panel button {
        min-height: 36px;
        padding: 0 14px;
        border: 1px solid rgb(83, 100, 113);
        border-radius: 6px;
        background: transparent;
        color: var(--xcsf-text);
        font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .xcsf-panel button:hover {
        background: rgba(239, 243, 244, 0.08);
      }

      .xcsf-panel .xcsf-primary {
        border-color: var(--xcsf-accent);
        background: var(--xcsf-accent);
        color: white;
        font-weight: 700;
      }

      .xcsf-icon-button {
        flex: 0 0 auto;
        width: 42px;
        min-height: 42px !important;
        padding: 0 !important;
        border-radius: 8px !important;
        font-size: 28px !important;
        line-height: 1 !important;
      }

      @media (prefers-color-scheme: light) {
        .xcsf-overlay {
          --xcsf-bg: rgb(255, 255, 255);
          --xcsf-bg-muted: rgb(247, 249, 249);
          --xcsf-field-bg: rgb(255, 255, 255);
          --xcsf-text: rgb(15, 20, 25);
          --xcsf-muted: rgb(83, 100, 113);
          --xcsf-border: rgb(207, 217, 222);
        }
      }

      @media (max-width: 560px) {
        .xcsf-overlay {
          align-items: stretch;
          padding: 10px;
        }

        .xcsf-header,
        .xcsf-footer,
        .xcsf-footer-main,
        .xcsf-status,
        .xcsf-status-actions,
        .xcsf-select-label {
          align-items: stretch;
          flex-direction: column;
        }

        .xcsf-select-label select {
          max-width: none;
        }

        .xcsf-stats {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.documentElement.append(style);
  }
})();
