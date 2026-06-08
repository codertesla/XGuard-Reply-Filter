// ==UserScript==
// @name         XGuard 评论净化器
// @namespace    https://github.com/codertesla/XGuard-Reply-Filter
// @version      1.2.0
// @description  按用户名、显示名关键词、评论内容关键词隐藏 X/Twitter 评论区垃圾回复。
// @author       sos
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEY = "xCommentSpamFilter.settings";
  const SCANNED_ATTR = "data-xcsf-scanned";
  const HIDDEN_ATTR = "data-xcsf-hidden";
  const MAIN_TWEET_ATTR = "data-xcsf-main-tweet";
  const DEFAULT_RAW_BASE = "https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main";

  const DEFAULT_SETTINGS = {
    enabled: true,
    hideMode: "remove", // "remove" or "placeholder"
    skipMainTweetOnStatusPage: true,
    remoteRulesEnabled: true,
    remoteUpdateIntervalHours: 12,
    blockedHandles: [
      "@Joeyce_x2",
    ],
    blockedNameKeywords: [
      "线下",
      "丄门",
      "上门",
      "喝茶",
    ],
    blockedTextKeywords: [
      "线下",
      "丄门",
      "上门",
      "喝茶",
      "约",
      "私信",
      "电报",
      "telegram",
      "whatsapp",
    ],
    remoteHandleUrls: [
      `${DEFAULT_RAW_BASE}/lists/handles.txt`,
    ],
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
      blockedHandles: [],
      blockedNameKeywords: [],
      blockedTextKeywords: [],
    },
  };

  const PLACEHOLDER_TEXT = "已由 XGuard 评论净化器隐藏";
  let settings = loadSettings();
  let effectiveRules = buildEffectiveRules(settings);
  let scanTimer = 0;
  let currentPath = location.pathname;

  addStyle();
  registerMenu();
  refreshRemoteRulesIfNeeded();
  scanSoon();
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
    const remoteCache = {
      ...DEFAULT_SETTINGS.remoteCache,
      ...(value.remoteCache || {}),
      blockedHandles: normalizeList(value.remoteCache?.blockedHandles),
      blockedNameKeywords: normalizeList(value.remoteCache?.blockedNameKeywords),
      blockedTextKeywords: normalizeList(value.remoteCache?.blockedTextKeywords),
    };

    return {
      ...DEFAULT_SETTINGS,
      ...value,
      hideMode: value.hideMode === "placeholder" ? "placeholder" : "remove",
      remoteUpdateIntervalHours: Number(value.remoteUpdateIntervalHours) || DEFAULT_SETTINGS.remoteUpdateIntervalHours,
      blockedHandles: normalizeList(value.blockedHandles),
      blockedNameKeywords: normalizeList(value.blockedNameKeywords),
      blockedTextKeywords: normalizeList(value.blockedTextKeywords),
      remoteHandleUrls: normalizeList(value.remoteHandleUrls),
      remoteNameKeywordUrls: normalizeList(value.remoteNameKeywordUrls),
      remoteTextKeywordUrls: normalizeList(value.remoteTextKeywordUrls),
      remoteCache,
    };
  }

  function buildEffectiveRules(value) {
    const remoteCache = value.remoteRulesEnabled ? value.remoteCache : DEFAULT_SETTINGS.remoteCache;
    return {
      blockedHandles: uniqueList([
        ...normalizeList(value.blockedHandles),
        ...normalizeList(remoteCache.blockedHandles),
      ]),
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
    GM_setValue(STORE_KEY, JSON.stringify(settings));
    resetScannedState();
    scanSoon();
  }

  function registerMenu() {
    GM_registerMenuCommand("打开过滤设置", openSettingsPanel);

    GM_registerMenuCommand("启用/停用过滤", () => {
      const enabled = !settings.enabled;
      saveSettings({ ...settings, enabled });
      alert(`XGuard 评论净化器：已${enabled ? "启用" : "停用"}`);
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

  function openSettingsPanel() {
    document.querySelector(".xcsf-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "xcsf-overlay";
    overlay.innerHTML = `
      <div class="xcsf-panel" role="dialog" aria-modal="true" aria-label="XGuard 评论净化器设置">
        <div class="xcsf-header">
          <div>
            <div class="xcsf-title">XGuard 评论净化器</div>
            <div class="xcsf-subtitle">本地规则每行一条；远程订阅支持多个 URL，每行一个。</div>
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

        <div class="xcsf-status" data-field="remoteStatus"></div>

        <label class="xcsf-field">
          <span>本地屏蔽 @用户名</span>
          <textarea data-field="blockedHandles" spellcheck="false" placeholder="@spam_user"></textarea>
        </label>

        <label class="xcsf-field">
          <span>本地屏蔽显示名关键词</span>
          <textarea data-field="blockedNameKeywords" spellcheck="false" placeholder="线下&#10;上门"></textarea>
        </label>

        <label class="xcsf-field">
          <span>本地屏蔽评论内容关键词</span>
          <textarea data-field="blockedTextKeywords" spellcheck="false" placeholder="telegram&#10;whatsapp"></textarea>
        </label>

        <details class="xcsf-json" open>
          <summary>远程订阅列表 URL</summary>
          <label class="xcsf-field xcsf-nested-field">
            <span>远程 @用户名列表 URL</span>
            <textarea data-field="remoteHandleUrls" spellcheck="false"></textarea>
          </label>
          <label class="xcsf-field xcsf-nested-field">
            <span>远程显示名关键词列表 URL</span>
            <textarea data-field="remoteNameKeywordUrls" spellcheck="false"></textarea>
          </label>
          <label class="xcsf-field xcsf-nested-field">
            <span>远程评论关键词列表 URL</span>
            <textarea data-field="remoteTextKeywordUrls" spellcheck="false"></textarea>
          </label>
          <div class="xcsf-row">
            <button type="button" data-action="update-remote">立即更新远程规则</button>
          </div>
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
          <div class="xcsf-footer-main">
            <button type="button" data-action="close">取消</button>
            <button type="button" data-action="save" class="xcsf-primary">保存规则</button>
          </div>
        </div>
      </div>
    `;

    document.documentElement.append(overlay);

    const fields = getPanelFields(overlay);
    fields.enabled.checked = settings.enabled;
    fields.skipMainTweetOnStatusPage.checked = settings.skipMainTweetOnStatusPage;
    fields.remoteRulesEnabled.checked = settings.remoteRulesEnabled;
    fields.hideMode.value = settings.hideMode;
    fields.remoteUpdateIntervalHours.value = String(settings.remoteUpdateIntervalHours);
    fields.blockedHandles.value = normalizeList(settings.blockedHandles).join("\n");
    fields.blockedNameKeywords.value = normalizeList(settings.blockedNameKeywords).join("\n");
    fields.blockedTextKeywords.value = normalizeList(settings.blockedTextKeywords).join("\n");
    fields.remoteHandleUrls.value = normalizeList(settings.remoteHandleUrls).join("\n");
    fields.remoteNameKeywordUrls.value = normalizeList(settings.remoteNameKeywordUrls).join("\n");
    fields.remoteTextKeywordUrls.value = normalizeList(settings.remoteTextKeywordUrls).join("\n");
    fields.remoteStatus.textContent = formatRemoteStatus();
    fields.jsonRules.value = JSON.stringify(settings, null, 2);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePanel(overlay);
    });

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanel(overlay);
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        saveFromPanel(overlay);
      }
    });

    overlay.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "close") closePanel(overlay);
      if (action === "save") saveFromPanel(overlay);
      if (action === "reset") resetPanelFields(overlay);
      if (action === "update-remote") updateRemoteFromPanel(overlay);
      if (action === "refresh-json") {
        getPanelFields(overlay).jsonRules.value = JSON.stringify(readSettingsFromPanel(overlay), null, 2);
      }
      if (action === "import-json") importJsonFromPanel(overlay);
    });

    fields.blockedHandles.focus();
  }

  function getPanelFields(root) {
    return {
      enabled: root.querySelector('[data-field="enabled"]'),
      skipMainTweetOnStatusPage: root.querySelector('[data-field="skipMainTweetOnStatusPage"]'),
      remoteRulesEnabled: root.querySelector('[data-field="remoteRulesEnabled"]'),
      hideMode: root.querySelector('[data-field="hideMode"]'),
      remoteUpdateIntervalHours: root.querySelector('[data-field="remoteUpdateIntervalHours"]'),
      blockedHandles: root.querySelector('[data-field="blockedHandles"]'),
      blockedNameKeywords: root.querySelector('[data-field="blockedNameKeywords"]'),
      blockedTextKeywords: root.querySelector('[data-field="blockedTextKeywords"]'),
      remoteHandleUrls: root.querySelector('[data-field="remoteHandleUrls"]'),
      remoteNameKeywordUrls: root.querySelector('[data-field="remoteNameKeywordUrls"]'),
      remoteTextKeywordUrls: root.querySelector('[data-field="remoteTextKeywordUrls"]'),
      remoteStatus: root.querySelector('[data-field="remoteStatus"]'),
      jsonRules: root.querySelector('[data-field="jsonRules"]'),
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
      blockedHandles: parseList(fields.blockedHandles.value),
      blockedNameKeywords: parseList(fields.blockedNameKeywords.value),
      blockedTextKeywords: parseList(fields.blockedTextKeywords.value),
      remoteHandleUrls: parseList(fields.remoteHandleUrls.value),
      remoteNameKeywordUrls: parseList(fields.remoteNameKeywordUrls.value),
      remoteTextKeywordUrls: parseList(fields.remoteTextKeywordUrls.value),
    };
  }

  function saveFromPanel(root) {
    saveSettings(readSettingsFromPanel(root));
    closePanel(root);
  }

  function resetPanelFields(root) {
    if (!confirm("确定要把面板中的规则恢复为默认值吗？")) return;

    const fields = getPanelFields(root);
    fields.enabled.checked = DEFAULT_SETTINGS.enabled;
    fields.skipMainTweetOnStatusPage.checked = DEFAULT_SETTINGS.skipMainTweetOnStatusPage;
    fields.remoteRulesEnabled.checked = DEFAULT_SETTINGS.remoteRulesEnabled;
    fields.hideMode.value = DEFAULT_SETTINGS.hideMode;
    fields.remoteUpdateIntervalHours.value = String(DEFAULT_SETTINGS.remoteUpdateIntervalHours);
    fields.blockedHandles.value = DEFAULT_SETTINGS.blockedHandles.join("\n");
    fields.blockedNameKeywords.value = DEFAULT_SETTINGS.blockedNameKeywords.join("\n");
    fields.blockedTextKeywords.value = DEFAULT_SETTINGS.blockedTextKeywords.join("\n");
    fields.remoteHandleUrls.value = DEFAULT_SETTINGS.remoteHandleUrls.join("\n");
    fields.remoteNameKeywordUrls.value = DEFAULT_SETTINGS.remoteNameKeywordUrls.join("\n");
    fields.remoteTextKeywordUrls.value = DEFAULT_SETTINGS.remoteTextKeywordUrls.join("\n");
    fields.remoteStatus.textContent = "面板已恢复默认值，保存后生效。";
    fields.jsonRules.value = JSON.stringify(DEFAULT_SETTINGS, null, 2);
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
  }

  async function updateRemoteFromPanel(root) {
    const fields = getPanelFields(root);
    saveSettings(readSettingsFromPanel(root));
    fields.remoteStatus.textContent = "正在更新远程规则...";
    await refreshRemoteRules({ force: true, notify: true });
    if (document.contains(root)) {
      fields.remoteStatus.textContent = formatRemoteStatus();
      fields.jsonRules.value = JSON.stringify(settings, null, 2);
    }
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

  async function refreshRemoteRulesIfNeeded() {
    if (!settings.remoteRulesEnabled) return;
    const intervalMs = settings.remoteUpdateIntervalHours * 60 * 60 * 1000;
    const updatedAt = Number(settings.remoteCache?.updatedAt) || 0;
    if (Date.now() - updatedAt < intervalMs) return;
    await refreshRemoteRules({ force: false, notify: false });
  }

  async function refreshRemoteRules({ force = false, notify = false } = {}) {
    if (!settings.remoteRulesEnabled && !force) return;

    try {
      const [blockedHandles, blockedNameKeywords, blockedTextKeywords] = await Promise.all([
        fetchRemoteLists(settings.remoteHandleUrls),
        fetchRemoteLists(settings.remoteNameKeywordUrls),
        fetchRemoteLists(settings.remoteTextKeywordUrls),
      ]);

      saveSettings({
        ...settings,
        remoteCache: {
          updatedAt: Date.now(),
          failedAt: 0,
          error: "",
          blockedHandles,
          blockedNameKeywords,
          blockedTextKeywords,
        },
      });

      if (notify) {
        alert(`远程规则已更新：@用户名 ${blockedHandles.length} 条，显示名关键词 ${blockedNameKeywords.length} 条，评论关键词 ${blockedTextKeywords.length} 条。`);
      }
    } catch (error) {
      saveSettings({
        ...settings,
        remoteCache: {
          ...settings.remoteCache,
          failedAt: Date.now(),
          error: error.message,
        },
      });

      if (notify) alert(`远程规则更新失败：${error.message}`);
    }
  }

  async function fetchRemoteLists(urls) {
    const cleanUrls = uniqueList(urls);
    if (!cleanUrls.length) return [];

    const responses = await Promise.all(cleanUrls.map(fetchText));
    return uniqueList(responses.flatMap(parseRemoteList));
  }

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
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

  function formatRemoteStatus() {
    const cache = settings.remoteCache || DEFAULT_SETTINGS.remoteCache;
    const updatedAt = Number(cache.updatedAt) || 0;
    const failedAt = Number(cache.failedAt) || 0;
    const counts = [
      `@用户名 ${normalizeList(cache.blockedHandles).length} 条`,
      `显示名关键词 ${normalizeList(cache.blockedNameKeywords).length} 条`,
      `评论关键词 ${normalizeList(cache.blockedTextKeywords).length} 条`,
    ].join("，");

    if (!settings.remoteRulesEnabled) return `远程订阅已停用。缓存：${counts}`;
    if (cache.error && failedAt) return `上次更新失败：${cache.error}。当前缓存：${counts}`;
    if (!updatedAt) return `尚未成功更新远程规则。当前缓存：${counts}`;
    return `远程规则上次更新：${new Date(updatedAt).toLocaleString()}。缓存：${counts}`;
  }

  function observePage() {
    const observer = new MutationObserver(() => {
      if (location.pathname !== currentPath) {
        currentPath = location.pathname;
        resetScannedState();
      }

      scanSoon();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function scanSoon() {
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanVisibleArticles, 120);
  }

  function scanVisibleArticles() {
    if (!settings.enabled) {
      restoreHiddenArticles();
      return;
    }

    markMainTweet();

    for (const article of document.querySelectorAll('article[role="article"]')) {
      if (article.getAttribute(SCANNED_ATTR) === currentScanSignature()) continue;
      article.setAttribute(SCANNED_ATTR, currentScanSignature());

      if (shouldSkipArticle(article)) {
        restoreArticle(article);
        continue;
      }

      const reason = getBlockReason(article);
      if (reason) {
        hideArticle(article, reason);
      } else {
        restoreArticle(article);
      }
    }
  }

  function currentScanSignature() {
    return [
      settings.enabled,
      settings.hideMode,
      settings.skipMainTweetOnStatusPage,
      settings.remoteRulesEnabled,
      settings.remoteCache?.updatedAt || 0,
      normalizeList(effectiveRules.blockedHandles).join("|"),
      normalizeList(effectiveRules.blockedNameKeywords).join("|"),
      normalizeList(effectiveRules.blockedTextKeywords).join("|"),
      currentPath,
    ].join("::");
  }

  function markMainTweet() {
    for (const article of document.querySelectorAll(`[${MAIN_TWEET_ATTR}]`)) {
      article.removeAttribute(MAIN_TWEET_ATTR);
    }

    if (!isStatusPage() || !settings.skipMainTweetOnStatusPage) return;

    const firstArticle = document.querySelector('main article[role="article"]');
    if (firstArticle) firstArticle.setAttribute(MAIN_TWEET_ATTR, "true");
  }

  function isStatusPage() {
    return /^\/[^/]+\/status\/\d+/.test(location.pathname);
  }

  function shouldSkipArticle(article) {
    if (article.getAttribute(MAIN_TWEET_ATTR) === "true") return true;
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    return !article.querySelector('[data-testid="User-Name"], [data-testid="tweetText"]');
  }

  function getBlockReason(article) {
    const author = extractAuthor(article);
    const text = normalizeText(extractTweetText(article));

    const blockedHandle = normalizeList(effectiveRules.blockedHandles)
      .map(normalizeHandle)
      .find((handle) => handle && author.handle === handle);
    if (blockedHandle) return `命中用户名 ${blockedHandle}`;

    const nameKeyword = findKeyword(author.displayName, effectiveRules.blockedNameKeywords);
    if (nameKeyword) return `命中显示名关键词「${nameKeyword}」`;

    const textKeyword = findKeyword(text, effectiveRules.blockedTextKeywords);
    if (textKeyword) return `命中评论关键词「${textKeyword}」`;

    return "";
  }

  function extractAuthor(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    if (!userName) return { displayName: "", handle: "" };

    const handleNode = Array.from(userName.querySelectorAll("span"))
      .map((node) => node.textContent.trim())
      .find((text) => /^@\w{1,15}$/.test(text));

    const displayNameLink = userName.querySelector('a[href^="/"]');

    return {
      displayName: normalizeText(textWithEmojiAlt(displayNameLink || userName)),
      handle: normalizeHandle(handleNode || ""),
    };
  }

  function extractTweetText(article) {
    const tweetText = article.querySelector('[data-testid="tweetText"]');
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

  function normalizeHandle(value) {
    const handle = String(value).trim().replace(/^@?/, "@").toLowerCase();
    return /^@\w{1,15}$/.test(handle) ? handle : "";
  }

  function normalizeText(value) {
    return String(value)
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function findKeyword(text, keywords) {
    const haystack = normalizeText(text);
    return normalizeList(keywords).find((keyword) => {
      const needle = normalizeText(keyword);
      return needle && haystack.includes(needle);
    });
  }

  function hideArticle(article, reason) {
    article.setAttribute(HIDDEN_ATTR, settings.hideMode);
    article.setAttribute("data-xcsf-reason", reason);

    if (settings.hideMode === "placeholder" && !article.querySelector(":scope > .xcsf-placeholder")) {
      const placeholder = document.createElement("button");
      placeholder.type = "button";
      placeholder.className = "xcsf-placeholder";
      placeholder.textContent = `${PLACEHOLDER_TEXT}: ${reason}`;
      placeholder.addEventListener("click", () => {
        article.setAttribute(HIDDEN_ATTR, "revealed");
      });
      article.prepend(placeholder);
    }
  }

  function restoreArticle(article) {
    article.removeAttribute(HIDDEN_ATTR);
    article.removeAttribute("data-xcsf-reason");
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
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(0, 0, 0, 0.58);
        color: rgb(231, 233, 234);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .xcsf-panel {
        box-sizing: border-box;
        width: min(680px, 100%);
        max-height: min(860px, calc(100vh - 40px));
        overflow: auto;
        border: 1px solid rgb(47, 51, 54);
        border-radius: 8px;
        background: rgb(22, 24, 28);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.48);
      }

      .xcsf-header,
      .xcsf-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px;
        border-bottom: 1px solid rgb(47, 51, 54);
      }

      .xcsf-footer {
        border-top: 1px solid rgb(47, 51, 54);
        border-bottom: 0;
      }

      .xcsf-title {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.25;
      }

      .xcsf-subtitle {
        margin-top: 4px;
        color: rgb(113, 118, 123);
        font-size: 14px;
        line-height: 1.4;
      }

      .xcsf-controls,
      .xcsf-field,
      .xcsf-status,
      .xcsf-json {
        display: grid;
        gap: 10px;
        margin: 16px;
      }

      .xcsf-status {
        padding: 10px 12px;
        border: 1px solid rgb(47, 51, 54);
        border-radius: 6px;
        background: rgba(29, 155, 240, 0.08);
        color: rgb(139, 152, 165);
        font-size: 14px;
        line-height: 1.45;
      }

      .xcsf-controls {
        padding: 12px;
        border: 1px solid rgb(47, 51, 54);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
      }

      .xcsf-check,
      .xcsf-select-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: rgb(231, 233, 234);
        font-size: 14px;
      }

      .xcsf-check {
        justify-content: flex-start;
      }

      .xcsf-field > span,
      .xcsf-json > summary,
      .xcsf-select-label > span {
        color: rgb(231, 233, 234);
        font-size: 14px;
        font-weight: 700;
      }

      .xcsf-field textarea,
      .xcsf-json textarea,
      .xcsf-select-label select {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid rgb(47, 51, 54);
        border-radius: 6px;
        background: rgb(0, 0, 0);
        color: rgb(231, 233, 234);
        font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        outline: none;
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
      .xcsf-footer-main {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .xcsf-nested-field {
        margin: 10px 0 0;
      }

      .xcsf-panel button {
        min-height: 36px;
        padding: 0 14px;
        border: 1px solid rgb(83, 100, 113);
        border-radius: 6px;
        background: transparent;
        color: rgb(231, 233, 234);
        font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .xcsf-panel button:hover {
        background: rgba(239, 243, 244, 0.08);
      }

      .xcsf-panel .xcsf-primary {
        border-color: rgb(29, 155, 240);
        background: rgb(29, 155, 240);
        color: white;
        font-weight: 700;
      }

      .xcsf-icon-button {
        width: 36px;
        padding: 0 !important;
        font-size: 24px !important;
        line-height: 1 !important;
      }

      @media (max-width: 560px) {
        .xcsf-overlay {
          align-items: stretch;
          padding: 10px;
        }

        .xcsf-header,
        .xcsf-footer,
        .xcsf-footer-main,
        .xcsf-select-label {
          align-items: stretch;
          flex-direction: column;
        }

        .xcsf-select-label select {
          max-width: none;
        }
      }
    `;
    document.documentElement.append(style);
  }
})();
