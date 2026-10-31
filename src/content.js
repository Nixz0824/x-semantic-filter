(function () {
  if (window.__xfLoaded) return;
  window.__xfLoaded = true;

  const D = globalThis.XF_DEFAULTS;
  const T = (zh, ...args) => (globalThis.XF_T ? globalThis.XF_T(zh, ...args) : zh);
  const MAX_INFLIGHT = 5;

  const SEL = {
    article: 'article[data-testid="tweet"]',
    text: '[data-testid="tweetText"]',
    userName: '[data-testid="User-Name"]',
    statusLink: 'a[href*="/status/"]',
  };

  let cfg = null;
  let enabled = true;
  let inflight = 0;
  let queue = [];
  const pendingBatch = new Set();
  const expanded = new Set();
  const counted = new Set();
  const counts = { folded: 0, dimmed: 0, hidden: 0, blocked: 0 };
  const recentErrors = [];
  let pill = null;
  let errorBar = null;
  let pauseUntil = 0;

  /* 自动反馈：高置信度时替用户点 X 的「对此帖子不感兴趣」 */
  const FEEDBACK_MAX = 8;
  const FEEDBACK_WINDOW = 10 * 60 * 1000;
  const NOT_INTERESTED_RE =
    /^(对此帖子不感兴趣|对这条广告不感兴趣|Not interested in this post|Not interested in this ad|このポストに興味がない|この広告に興味がない)$/i;
  const feedbackTimes = [];
  let feedbackInFlight = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 分类配色：仇恨/暴力偏红，政治攻击偏橙，广告偏黄，水文偏灰
  const CAT_COLOR = {
    extremist: "#f4212e",
    hate_speech: "#f4212e",
    malicious_image: "#f4212e",
    hostile_cn: "#ff7a00",
    politician_insult: "#ff7a00",
    rage_bait: "#ff7a00",
    rage: "#ff7a00",
    ad: "#d9a300",
    crypto: "#d9a300",
    bait: "#d9a300",
    slop: "#71767b",
    lowinfo: "#71767b",
  };

  /* ---------------------------------------------------------------- */
  /* 配置                                                              */
  /* ---------------------------------------------------------------- */

  async function loadCfg() {
    const stored = await chrome.storage.sync.get(null);
    cfg = Object.assign({}, D, stored);
    if (!Array.isArray(cfg.rules) || !cfg.rules.length) cfg.rules = D.rules;
    enabled = cfg.enabled !== false;
    if (globalThis.XF_I18N) {
      const lang = globalThis.XF_I18N.detectLang(cfg.lang);
      globalThis.XF_I18N.setLang(lang, { silent: true });
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const touched = Object.keys(changes);
    loadCfg().then(() => {
      if (!enabled) {
        cleanup();
        return;
      }
      if (touched.some((k) => k === "rules" || k === "threshold" || k === "actionMode" || k === "provider")) {
        cleanup();
        scanAll();
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* 提取                                                              */
  /* ---------------------------------------------------------------- */

  function inScope() {
    if (cfg.scope === "all") return true;
    const p = location.pathname;
    return p === "/" || p === "/home";
  }

  function normalizeImg(src) {
    if (!src || src.startsWith("data:")) return null;
    try {
      const u = new URL(src);
      if (!u.hostname.endsWith("pbs.twimg.com")) return null;
      if (u.pathname.includes("/profile_images/") || u.pathname.includes("/emoji/")) return null;
      if (!/media|thumb/.test(u.pathname)) return null;
      u.searchParams.set("name", "small");
      return u.toString();
    } catch (_) {
      return null;
    }
  }

  function extract(el) {
    const textEl = el.querySelector(SEL.text);
    let text = textEl ? textEl.innerText.trim() : "";
    const quote = el.querySelector('[data-testid="quoteTweet"]');
    if (quote) {
      const q = quote.querySelector(SEL.text);
      if (q && q.innerText.trim()) text += "\n\n[引用]\n" + q.innerText.trim();
    }

    const images = [];
    const push = (src) => {
      const u = normalizeImg(src);
      if (u && !images.includes(u)) images.push(u);
    };
    el.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => push(img.currentSrc || img.src));
    el.querySelectorAll("video[poster]").forEach((v) => push(v.poster));
    if (quote) quote.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => push(img.currentSrc || img.src));

    const hasText = text.replace(/\s/g, "").length >= 4;
    if (!hasText && !images.length) return null;

    const link = Array.from(el.querySelectorAll(SEL.statusLink)).find((a) => a.querySelector("time"));
    const href = link ? link.getAttribute("href") : "";
    const m = href.match(/\/status\/(\d+)/);
    if (!m) return null;
    const id = m[1];
    // 详情页里当前这条主帖不折叠，否则用户点进来看到的是自己的横幅
    const pageId = (location.pathname.match(/\/status\/(\d+)/) || [])[1];
    if (pageId && id === pageId && location.pathname.includes("/status/")) return null;

    const nameBlock = el.querySelector(SEL.userName);
    const handleMatch = (nameBlock ? nameBlock.innerText : "").match(/@([A-Za-z0-9_]+)/);

    return {
      id,
      handle: handleMatch ? handleMatch[1] : "",
      text: text.slice(0, 900),
      images: images.slice(0, 2),
    };
  }

  /* ---------------------------------------------------------------- */
  /* 队列                                                              */
  /* ---------------------------------------------------------------- */

  function collect(root, out) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(SEL.article)) out.push(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(SEL.article).forEach((a) => out.push(a));
    }
  }

  function enqueue(el) {
    if (Date.now() < pauseUntil) return;
    if (!el.isConnected) return;
    if (el.dataset.xfState) {
      // React 重渲染可能把横幅冲掉，但保留了我们打的标记。检测到这种情况就重跑一次。
      const orphaned =
        el.dataset.xfState === "done" && !el.querySelector(":scope > .xf-banner");
      if (!orphaned) return;
      delete el.dataset.xfState;
      delete el.dataset.xfAction;
      delete el.dataset.xfBase;
    }
    const info = extract(el);
    if (!info) {
      el.dataset.xfState = "skip";
      return;
    }

    // 作者黑名单：本地直接隐藏，不调用模型、不花钱，也不受「生效范围」限制，
    // 主页、搜索、详情页回复里只要是他发的都会消失。
    const block = (cfg.blocklist || []).map((h) => String(h).replace(/^@/, "").trim().toLowerCase()).filter(Boolean);
    if (info.handle && block.includes(info.handle.toLowerCase())) {
      // 屏蔽名单不静默隐藏，按「折叠」处理：留一条可展开的提示
      apply(el, info, {
        action: "fold",
        label: T("屏蔽作者"),
        note: T("已屏蔽"),
        prob: 1,
        ruleId: "blocklist",
      });
      counts.blocked += 1;
      updatePill();
      return;
    }

    if (!inScope()) return;

    const allow = (cfg.allowlist || []).map((h) => String(h).replace(/^@/, "").toLowerCase());
    if (info.handle && allow.includes(info.handle.toLowerCase())) {
      el.dataset.xfState = "skip";
      return;
    }
    el.dataset.xfState = "queued";
    queue.push({ el, info });
    pump();
  }

  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      const job = queue.shift();
      if (!job.el.isConnected) continue;
      inflight++;
      run(job).finally(() => {
        inflight--;
        pump();
      });
    }
  }

  async function run(job) {
    let res;
    try {
      res = await sendClassify(job.info);
    } catch (err) {
      job.el.dataset.xfState = "error";
      noteError(String((err && err.message) || err));
      return;
    }
    if (res && res.cooldown) {
      pauseUntil = res.until || Date.now() + 3600000;
      job.el.dataset.xfState = "skip";
      noteCooldown(pauseUntil, res);
      return;
    }
    if (!res || res.action === "none") {
      job.el.dataset.xfState = "clean";
      return;
    }
    // 先让反馈去排队点「不感兴趣」，折叠不等它，避免看到菜单闪烁后帖子还在
    maybeFeedback(job.el, res);
    apply(job.el, job.info, res);
  }

  function sendClassify(item, attempt) {
    attempt = attempt || 0;
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "classify", item }, (res) => {
        if (chrome.runtime.lastError) {
          if (attempt < 1) {
            setTimeout(() => {
              sendClassify(item, attempt + 1).then(resolve, reject);
            }, 300);
            return;
          }
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res) {
          reject(new Error("后台无响应"));
          return;
        }
        if (res.error) noteError(res.error);
        resolve(res);
      });
    });
  }

  function canFeedback(res) {
    if (cfg.feedbackEnabled === false) return false;
    if (res.action === "dim") return false; // 只是低信号，不值得喂给推荐算法
    if ((res.prob || 0) < (cfg.feedbackThreshold || 0.9)) return false;
    if (location.pathname !== "/home" && location.pathname !== "/") return false;
    if (feedbackInFlight) return false;
    const now = Date.now();
    while (feedbackTimes.length && now - feedbackTimes[0] > FEEDBACK_WINDOW) feedbackTimes.shift();
    return feedbackTimes.length < FEEDBACK_MAX;
  }

  function findNotInterested() {
    const menu = document.querySelector('[role="menu"]');
    if (!menu) return null;
    return (
      Array.from(menu.querySelectorAll('[role="menuitem"]')).find((item) =>
        NOT_INTERESTED_RE.test(item.innerText.replace(/\s+/g, " ").trim())
      ) || null
    );
  }

  function closeMenu(caret) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    if (document.querySelector('[role="menu"]')) {
      try {
        caret.click();
      } catch (_) {}
    }
  }

  async function maybeFeedback(el, res) {
    if (!canFeedback(res)) return;
    const caret = el.querySelector('[data-testid="caret"]');
    if (!caret) return;

    feedbackInFlight = true;
    feedbackTimes.push(Date.now());
    try {
      caret.click();
      let item = null;
      for (let i = 0; i < 12 && !item; i++) {
        await sleep(60);
        item = findNotInterested();
      }
      if (!item) {
        closeMenu(caret);
        return;
      }
      item.click();
      await sleep(120);
      chrome.runtime.sendMessage({ type: "feedback" }, () => void chrome.runtime.lastError);
    } catch (_) {
      /* 反馈失败不影响折叠 */
    } finally {
      feedbackInFlight = false;
    }
  }

  function surfaceColor(el) {
    const own = getComputedStyle(el).backgroundColor;
    if (own && own !== "rgba(0, 0, 0, 0)" && own !== "transparent") return own;
    const body = getComputedStyle(document.body).backgroundColor;
    if (body && body !== "rgba(0, 0, 0, 0)" && body !== "transparent") return body;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
  }

  function buildBanner(info, res) {
    const b = document.createElement("section");
    b.className = "xf-banner";
    b.style.setProperty("--xf-surface", surfaceColor(document.documentElement));
    b.style.setProperty("--xf-cat", CAT_COLOR[res.ruleId] || "#1d9bf0");
    b.title = `${res.label || "已过滤"} · ${Math.round((res.prob || 0) * 100)}%，点击展开`;

    const icon = document.createElement("span");
    icon.className = "xf-icon";
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/></svg>';

    const tag = document.createElement("span");
    tag.className = "xf-tag";
    tag.textContent = res.label || "已过滤";

    const prob = document.createElement("span");
    prob.className = "xf-prob";
    prob.textContent = Math.round((res.prob || 0) * 100) + "%";

    const note = document.createElement("span");
    note.className = "xf-note";
    note.textContent = res.note || (res.action === "hide" ? T("已隐藏") : res.action === "dim" ? T("低信号") : T("已折叠"));

    const spacer = document.createElement("span");
    spacer.className = "xf-spacer";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "xf-btn xf-toggle";
    btn.textContent = T("展开");

    b.append(icon, tag, prob, note, spacer, btn);

    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle(info, b);
    });
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    return b;
  }

  function apply(el, info, res) {
    if (!el.isConnected) return;
    el.dataset.xfState = "done";
    el.dataset.xfBase = res.action;
    el.dataset.xfLabel = res.label || "";

    const banner = buildBanner(info, res);
    el.prepend(banner);

    if (expanded.has(info.id)) {
      setExpanded(el);
    } else {
      setAction(el, res.action);
      if (!counted.has(info.id)) {
        counted.add(info.id);
        counts[res.action === "fold" ? "folded" : res.action === "hide" ? "hidden" : "dimmed"]++;
      }
    }
    updatePill();
  }

  function setAction(el, action) {
    // 用 data 属性而不是 class：X 在 hover 时会重写 className，class 会被抹掉
    el.dataset.xfAction = action === "hide" ? "hidden" : action;
  }

  function setExpanded(el) {
    el.dataset.xfAction = "expanded";
    const btn = el.querySelector(".xf-banner .xf-toggle");
    if (btn) btn.textContent = T("收起");
  }

  function toggle(info, banner) {
    const el = banner.closest("article");
    if (!el) return;
    if (el.dataset.xfAction === "expanded") {
      expanded.delete(info.id);
      setAction(el, el.dataset.xfBase || "fold");
      banner.querySelector(".xf-toggle").textContent = T("展开");
      banner.title = "点击展开";
    } else {
      expanded.add(info.id);
      setExpanded(el);
      banner.title = "点击收起";
    }
  }

  function updatePill() {
    const total = counts.folded + counts.hidden + counts.dimmed;
    if (!total) return;
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "xf-pill";
      const text = document.createElement("span");
      text.className = "xf-pill-text";
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "xf-pill-btn";
      toggleBtn.textContent = "显示全部";
      toggleBtn.addEventListener("click", () => {
        const on = document.documentElement.dataset.xfReveal === "1";
        if (on) delete document.documentElement.dataset.xfReveal;
        else document.documentElement.dataset.xfReveal = "1";
        toggleBtn.textContent = on ? T("显示全部") : T("恢复过滤");
      });
      pill.append(text, toggleBtn);
      document.body.appendChild(pill);
    }
    const parts = [];
    if (counts.folded) parts.push(T("折叠") + " " + counts.folded);
    if (counts.hidden) parts.push(T("隐藏") + " " + counts.hidden);
    if (counts.dimmed) parts.push(T("淡化") + " " + counts.dimmed);
    if (counts.blocked) parts.push(T("屏蔽") + " " + counts.blocked);
    pill.querySelector(".xf-pill-text").textContent = T("语义过滤 · ") + parts.join(" · ");
  }

  function noteCooldown(until, res) {
    if (errorBar) return;
    const d = new Date(until);
    const hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    errorBar = document.createElement("div");
    errorBar.className = "xf-error";
    const span = document.createElement("span");
    span.textContent = res && res.budget
      ? T("今日请求已达上限（%n 条），明天自动恢复", res.limit || 0)
      : T("模型额度用完，过滤已暂停，%s 后自动恢复", hh);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "xf-pill-btn";
    btn.textContent = T("关闭");
    btn.addEventListener("click", () => {
      errorBar.remove();
      errorBar = null;
    });
    errorBar.append(span, btn);
    document.body.appendChild(errorBar);
  }

  function noteError(message) {
    recentErrors.push(Date.now());
    while (recentErrors.length && Date.now() - recentErrors[0] > 30000) recentErrors.shift();
    if (recentErrors.length < 3) return;
    if (errorBar) return;
    errorBar = document.createElement("div");
    errorBar.className = "xf-error";
    const span = document.createElement("span");
    span.textContent = T("过滤器请求失败：") + message.slice(0, 120);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "xf-pill-btn";
    btn.textContent = T("关闭");
    btn.addEventListener("click", () => {
      errorBar.remove();
      errorBar = null;
      recentErrors.length = 0;
    });
    errorBar.append(span, btn);
    document.body.appendChild(errorBar);
  }

  /* ---------------------------------------------------------------- */
  /* 清理与扫描                                                        */
  /* ---------------------------------------------------------------- */

  function cleanup() {
    document.querySelectorAll(".xf-banner").forEach((b) => b.remove());
    document.querySelectorAll(SEL.article).forEach((a) => {
      delete a.dataset.xfState;
      delete a.dataset.xfAction;
      delete a.dataset.xfBase;
      delete a.dataset.xfLabel;
    });
    delete document.documentElement.dataset.xfReveal;
    if (pill) {
      pill.remove();
      pill = null;
    }
    if (errorBar) {
      errorBar.remove();
      errorBar = null;
    }
    queue = [];
    counted.clear();
    counts.folded = counts.dimmed = counts.hidden = counts.blocked = 0;
  }

  function scanAll() {
    if (!enabled) return;
    const out = [];
    collect(document.body, out);
    out.forEach(enqueue);
  }

  let batchTimer = null;
  function schedule(nodes) {
    if (!enabled) return;
    for (const n of nodes) pendingBatch.add(n);
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      const arr = Array.from(pendingBatch);
      pendingBatch.clear();
      arr.forEach(enqueue);
    }, 150);
  }

  function startObserver() {
    const mo = new MutationObserver((records) => {
      if (!enabled) return;
      const found = [];
      for (const rec of records) {
        for (const n of rec.addedNodes) {
          if (n.nodeType === 1) collect(n, found);
        }
      }
      if (found.length) schedule(found);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------------------------------------------------------------- */

  (async function init() {
    await loadCfg();
    if (!enabled) return;
    scanAll();
    startObserver();
  })();
})();
