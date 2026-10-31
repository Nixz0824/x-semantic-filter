(function () {
  const D = globalThis.XF_DEFAULTS;
  const MAX_RULES = globalThis.XF_MAX_RULES || 10;

  const $ = (sel) => document.querySelector(sel);
  const rulesEl = $("#rules");
  const toastEl = $("#toast");
  const T = (zh, ...args) => (globalThis.XF_T ? globalThis.XF_T(zh, ...args) : zh);

  let current = null;
  let langPref = "auto";
  let saveTimer = null;
  let toastTimer = null;

  const ACTIONS = [
    ["fold", "折叠帖子"],
    ["dim", "淡化帖子"],
    ["hide", "隐藏帖子"],
  ];

  // 预设：一键替换整套规则。「仇恨 / 政治攻击」这套是按内容特征判断语气和行为，
  // 不按立场判断，所以能跨语言生效，也更不容易误伤事实报道。
  const PRESETS = {
    spam: {
      label: "垃圾信息",
      labelEn: "Spam",
      build: () => D.rules.map((r) => Object.assign({}, r)),
    },
    political: {
      label: "仇恨 / 政治攻击",
      labelEn: "Hate / political attacks",
      build: () => [
        {
          id: "hostile_cn",
          label: "涉华敌意言论",
          desc:
            "内容涉及中国、中国政府或中国政治人物，并带有嘲讽、贬损、诅咒、去人性化或煽动性语气。纯事实报道、政策分析、有依据的批评不算。",
          action: "fold",
          threshold: 0.76,
          enabled: true,
        },
        {
          id: "hate_speech",
          label: "仇恨与歧视",
          desc:
            "针对国家、民族、族群、宗教或语言的侮辱、贬低、去人性化表达，或呼吁排斥某一群体。",
          action: "fold",
          threshold: 0.72,
          enabled: true,
        },
        {
          id: "politician_insult",
          label: "政治人物人身攻击",
          desc:
            "对政治人物使用侮辱性绰号、诅咒、暴力暗示或性化羞辱，而不是对其政策、行为的事实性批评。",
          action: "fold",
          threshold: 0.75,
          enabled: true,
        },
        {
          id: "extremist",
          label: "煽动暴力",
          desc:
            "呼吁对某个国家、族群或个人使用暴力、清算、驱逐，或为这类行为叫好。",
          action: "hide",
          threshold: 0.8,
          enabled: true,
        },
        {
          id: "malicious_image",
          label: "恶意合成图像",
          desc:
            "把政治人物、国家象征或族群形象做成侮辱性、血腥、性化、嘲讽性的梗图或合成图。只看图片内容和语气，不看配文立场。",
          action: "fold",
          threshold: 0.75,
          enabled: true,
        },
        {
          id: "rage_bait",
          label: "情绪引战",
          desc:
            "以激怒读者、挑起对立为目的，正文没有实质信息，读完只想吵架。",
          action: "fold",
          threshold: 0.72,
          enabled: true,
        },
        {
          id: "ad",
          label: "广告 / 带货",
          desc:
            "在推销商品、课程、社群、服务或自己的账号，通常带购买链接、优惠码、私信领取、限时名额。单纯分享自己用过的东西不算。",
          action: "fold",
          threshold: 0.75,
          enabled: true,
        },
        {
          id: "crypto",
          label: "币圈喊单",
          desc:
            "推荐具体代币、合约点位、空投、暴富叙事，或拉人进群、晒收益截图。",
          action: "fold",
          threshold: 0.72,
          enabled: true,
        },
      ],
    },
  };

  function presetLabel(p) {
    return globalThis.XF_I18N && globalThis.XF_I18N.getLang() === "en" ? p.labelEn : p.label;
  }

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    const n = rulesEl.querySelectorAll(".rule").length;
    if (!confirm(T("用「%s」预设替换当前 %n 条规则？", presetLabel(p), n))) return;
    current.rules = p.build();
    renderRules();
    save();
    showToast(T("已载入「%s」预设", presetLabel(p)));
  }

  /* ---------------------------------------------------------------- */
  /* 自然语言加规则 / 导入导出                                          */
  /* ---------------------------------------------------------------- */

  function makeLabel(text) {
    let t = String(text || "")
      .trim()
      .replace(/^(帮我)?(不想看|不想看到|不要看|别给我看|屏蔽|过滤掉?|隐藏)/, "")
      .trim();
    t = t.replace(/[，。！？,.!?].*$/, "").trim();
    if (!t) t = "自定义规则";
    return t.slice(0, 14);
  }

  function normalizeRules(list) {
    if (!Array.isArray(list)) throw new Error("规则必须是数组");
    return list.slice(0, MAX_RULES).map((r, i) => ({
      id: String(r.id || "r_" + Date.now().toString(36) + i),
      label: String(r.label || "规则 " + (i + 1)).slice(0, 40),
      desc: String(r.desc || ""),
      action: ["fold", "dim", "hide"].includes(r.action) ? r.action : "fold",
      threshold: Math.min(0.99, Math.max(0.5, Number(r.threshold) || 0.72)),
      enabled: r.enabled !== false,
    }));
  }

  async function addRuleFromText(text, opts) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const rules = collect().rules;
    if (rules.length >= MAX_RULES) {
      showToast(T("最多 %n 条规则", MAX_RULES));
      return null;
    }
    // 去掉「不想看 / 屏蔽」这类否定前缀：判定标准要是正面描述，
    // 否则模型看到“是否属于『不想看房价』”会犯迷糊。
    const body = raw
      .replace(/^(帮我)?(不想看|不想看到|不要看|别给我看|屏蔽|过滤掉?|隐藏)/, "")
      .trim() || raw;

    const rule = {
      id: "r_" + Date.now().toString(36),
      label: (opts && opts.label) || makeLabel(raw),
      desc: body + "。判断时看整条帖子在表达什么，不要只因为出现相关关键词就命中。",
      action: (opts && opts.action) || "fold",
      threshold: Number((opts && opts.threshold) || $("#threshold").value) || 0.72,
      enabled: true,
    };
    rules.push(rule);
    current.rules = rules;
    renderRules();
    await save(true);
    showToast(T("已添加规则：%s", rule.label));
    return rule;
  }

  /* 给外部 Agent 用的稳定接口，见 AGENT.md */
  window.XFAgent = {
    version: 1,
    async getConfig() {
      return collect();
    },
    async setConfig(patch) {
      const next = Object.assign(collect(), patch || {});
      current = next;
      await chrome.storage.sync.set(next);
      paint(); // 表单按新值重绘，避免下一次 collect() 把旧值写回去
      return collect();
    },
    async addRule(rule) {
      const rules = collect().rules;
      if (rules.length >= MAX_RULES) throw new Error("已达规则上限");
      const next = normalizeRules([rule])[0];
      rules.push(next);
      current.rules = rules;
      renderRules();
      await save(true);
      return next;
    },
    addRuleFromText,
    async removeRule(id) {
      current.rules = collect().rules.filter((r) => r.id !== id);
      renderRules();
      await save(true);
      return current.rules;
    },
    async applyPreset(name) {
      const p = PRESETS[name];
      if (!p) throw new Error("未知预设：" + name);
      current.rules = p.build();
      renderRules();
      await save(true);
      return current.rules;
    },
    listPresets() {
      return Object.keys(PRESETS);
    },
    exportRules() {
      return JSON.stringify(collect().rules, null, 2);
    },
    async importRules(json) {
      const arr = typeof json === "string" ? JSON.parse(json) : json;
      current.rules = normalizeRules(arr);
      renderRules();
      await save(true);
      return current.rules;
    },
  };

  /* ---------------------------------------------------------------- */
  /* 读取 / 写入                                                       */
  /* ---------------------------------------------------------------- */

  async function load() {
    const stored = await chrome.storage.sync.get(null);
    current = Object.assign({}, D, stored);
    if (!Array.isArray(current.rules) || !current.rules.length) current.rules = D.rules.slice();
    paint();
  }

  function paint() {
    langPref = current.lang || "auto";
    $("#enabled").checked = current.enabled !== false;

    document.querySelectorAll('input[name="provider"]').forEach((r) => {
      r.checked = r.value === current.provider;
      r.closest(".provider").classList.toggle("is-active", r.checked);
    });
    document.querySelectorAll(".fields[data-for]").forEach((f) => {
      f.hidden = f.dataset.for !== current.provider;
    });

    $("#typesafeKey").value = current.typesafeKey || "";
    $("#typesafeModel").value = current.typesafeModel || "jev-latest";
    $("#typesafeBase").value = current.typesafeBase || "https://api.typesafe.ai";
    $("#clefAccountId").value = current.clefAccountId || "";
    $("#clefKey").value = current.clefKey || "";
    $("#clefModel").value = current.clefModel || "@cf/cloudflare/clef-omni";
    $("#baseUrl").value = current.baseUrl || "";
    $("#apiKey").value = current.apiKey || "";
    $("#model").value = current.model || "";

    $("#visionEnabled").checked = !!current.visionEnabled;
    $("#visionBaseUrl").value = current.visionBaseUrl || "";
    $("#visionApiKey").value = current.visionApiKey || "";
    $("#visionModel").value = current.visionModel || "";
    $("#visionMaxImages").value = String(current.visionMaxImages || 1);
    $("#visionFields").hidden = !current.visionEnabled;
    updateVisionWarn(current);

    $("#feedbackEnabled").checked = current.feedbackEnabled !== false;
    $("#feedbackThreshold").value = current.feedbackThreshold || 0.9;
    $("#dailyBudget").value = String(current.dailyBudget == null ? 500 : current.dailyBudget);

    $("#actionMode").value = current.actionMode || "rule";
    $("#scope").value = current.scope || "all";
    $("#threshold").value = current.threshold;
    $("#minActConfidence").value = current.minActConfidence;
    updateSliders();

    $("#blocklist").value = (current.blocklist || []).join("\n");
    $("#allowlist").value = (current.allowlist || []).join("\n");

    renderRules();
    refreshStats();
    applyLangUI();
  }

  function applyLangUI() {
    const lang = globalThis.XF_I18N
      ? globalThis.XF_I18N.detectLang(current.lang)
      : "zh";
    if (globalThis.XF_I18N) globalThis.XF_I18N.setLang(lang);
    document.querySelectorAll("#langSwitch button").forEach((b) => {
      b.classList.toggle("active", b.dataset.lang === lang);
    });
  }

  function collect() {
    const rules = Array.from(rulesEl.querySelectorAll(".rule")).map((el) => ({
      id: el.dataset.id,
      label: el.querySelector(".rule-label").value.trim() || "未命名",
      desc: el.querySelector(".rule-desc").value.trim(),
      action: el.querySelector(".rule-action").value,
      threshold: clamp(Number(el.querySelector(".rule-threshold").value) || 0.7, 0.5, 0.99),
      enabled: el.querySelector(".rule-enabled").checked,
    }));

    return {
      enabled: $("#enabled").checked,
      lang: langPref,
      provider: (document.querySelector('input[name="provider"]:checked') || {}).value || "typesafe",
      typesafeKey: $("#typesafeKey").value.trim(),
      typesafeModel: $("#typesafeModel").value.trim() || "jev-latest",
      typesafeBase: $("#typesafeBase").value.trim() || "https://api.typesafe.ai",
      clefAccountId: $("#clefAccountId").value.trim(),
      clefKey: $("#clefKey").value.trim(),
      clefModel: $("#clefModel").value.trim() || "@cf/cloudflare/clef-omni",
      baseUrl: $("#baseUrl").value.trim(),
      apiKey: $("#apiKey").value.trim(),
      model: $("#model").value.trim(),
      visionEnabled: $("#visionEnabled").checked,
      visionBaseUrl: $("#visionBaseUrl").value.trim(),
      visionApiKey: $("#visionApiKey").value.trim(),
      visionModel: $("#visionModel").value.trim(),
      visionMaxImages: Number($("#visionMaxImages").value) || 1,
      feedbackEnabled: $("#feedbackEnabled").checked,
      feedbackThreshold: Number($("#feedbackThreshold").value) || 0.9,
      dailyBudget: Math.max(0, Number($("#dailyBudget").value) || 0),
      threshold: Number($("#threshold").value),
      minActConfidence: Number($("#minActConfidence").value),
      actionMode: $("#actionMode").value,
      scope: $("#scope").value,
      blocklist: $("#blocklist")
        .value.split(/[\n,]/)
        .map((h) => h.trim().replace(/^@/, ""))
        .filter(Boolean),
      allowlist: $("#allowlist")
        .value.split(/\n+/)
        .map((s) => s.trim().replace(/^@/, ""))
        .filter(Boolean),
      rules,
    };
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function queueSave() {
    current = collect();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 350);
  }

  async function save(silent) {
    clearTimeout(saveTimer);
    current = collect();
    await chrome.storage.sync.set(current);
    updateVisionWarn(current);
    if (!silent) showToast(T("已保存"));
    updateRuleCount();
  }

  function updateVisionWarn(c) {
    const ready =
      (c.visionBaseUrl || c.baseUrl) && (c.visionApiKey || c.apiKey) && (c.visionModel || c.model);
    const needed = c.visionEnabled && c.provider !== "clef";
    $("#visionWarn").hidden = !(needed && !ready);
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  }

  /* ---------------------------------------------------------------- */
  /* 规则渲染                                                          */
  /* ---------------------------------------------------------------- */

  function renderRules() {
    rulesEl.innerHTML = "";
    current.rules.forEach((rule, i) => rulesEl.appendChild(ruleNode(rule, i)));
    updateRuleCount();
    if (globalThis.XF_I18N) globalThis.XF_I18N.applyI18n(rulesEl);
  }

  function ruleNode(rule, index) {
    const box = document.createElement("div");
    box.className = "rule";
    box.dataset.id = rule.id;

    const top = document.createElement("div");
    top.className = "rule-top";

    const idx = document.createElement("span");
    idx.className = "rule-index";
    idx.textContent = String(index + 1);

    const label = document.createElement("input");
    label.type = "text";
    label.className = "rule-label";
    label.value = rule.label;
    label.spellcheck = false;

    const toggle = document.createElement("label");
    toggle.className = "mini";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.className = "rule-enabled";
    enabled.checked = rule.enabled !== false;
    toggle.append(enabled, document.createTextNode("启用"));

    top.append(idx, label, toggle);

    const desc = document.createElement("textarea");
    desc.className = "rule-desc";
    desc.value = rule.desc;
    desc.placeholder = T("用自然语言描述这类内容长什么样，越具体越准。");

    const bottom = document.createElement("div");
    bottom.className = "rule-bottom";

    const actionWrap = document.createElement("label");
    actionWrap.className = "mini";
    const action = document.createElement("select");
    action.className = "rule-action";
    ACTIONS.forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = T(t);
      if (rule.action === v) o.selected = true;
      action.appendChild(o);
    });
    actionWrap.append(document.createTextNode(T("命中后")), action);

    const thWrap = document.createElement("label");
    thWrap.className = "mini";
    const th = document.createElement("input");
    th.type = "number";
    th.className = "rule-threshold";
    th.min = "0.5";
    th.max = "0.99";
    th.step = "0.01";
    th.value = rule.threshold;
    thWrap.append(document.createTextNode(T("阈值")), th);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger rule-del";
    del.textContent = T("删除");
    del.style.marginLeft = "auto";
    del.addEventListener("click", () => {
      box.remove();
      queueSave();
      refreshIndexes();
    });

    bottom.append(actionWrap, thWrap, del);

    box.append(top, desc, bottom);
    return box;
  }

  function refreshIndexes() {
    rulesEl.querySelectorAll(".rule").forEach((el, i) => {
      el.querySelector(".rule-index").textContent = String(i + 1);
    });
    updateRuleCount();
  }

  function updateRuleCount() {
    const n = rulesEl.querySelectorAll(".rule").length;
    const en = globalThis.XF_I18N && globalThis.XF_I18N.getLang() === "en";
    $("#ruleCount").textContent = `${n} / ${MAX_RULES}` + (en ? " rules" : " 条");
    $("#addRule").disabled = n >= MAX_RULES;
  }

  $("#presetSpam").addEventListener("click", () => applyPreset("spam"));
  $("#presetPolitical").addEventListener("click", () => applyPreset("political"));

  $("#nlAdd").addEventListener("click", async () => {
    const input = $("#nlRule");
    const rule = await addRuleFromText(input.value);
    if (rule) input.value = "";
  });

  $("#nlRule").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#nlAdd").click();
    }
  });

  $("#exportRules").addEventListener("click", () => {
    $("#rulesJson").value = JSON.stringify(collect().rules, null, 2);
    showToast(T("已导出到下方文本框"));
  });

  $("#importRules").addEventListener("click", async () => {
    try {
      const arr = JSON.parse($("#rulesJson").value);
      current.rules = normalizeRules(arr);
      renderRules();
      await save(true);
      showToast(T("已导入 %n 条规则", current.rules.length));
    } catch (e) {
      showToast(T("JSON 解析失败：%s", e.message));
    }
  });

  $("#addRule").addEventListener("click", () => {
    if (rulesEl.querySelectorAll(".rule").length >= MAX_RULES) return;
    const rule = {
      id: "r_" + Date.now().toString(36),
      label: T("新规则"),
      desc: "",
      action: "fold",
      threshold: Number($("#threshold").value),
      enabled: true,
    };
    rulesEl.appendChild(ruleNode(rule, rulesEl.children.length));
    queueSave();
    updateRuleCount();
  });

  /* ---------------------------------------------------------------- */
  /* 交互                                                              */
  /* ---------------------------------------------------------------- */

  function updateSliders() {
    $("#thresholdVal").textContent = Number($("#threshold").value).toFixed(2);
    $("#minActVal").textContent = Number($("#minActConfidence").value).toFixed(2);
    $("#feedbackVal").textContent = Number($("#feedbackThreshold").value).toFixed(2);
  }

  document.addEventListener("input", (e) => {
    if (e.target.matches("#threshold, #minActConfidence, #feedbackThreshold")) updateSliders();
    if (e.target.closest("main")) queueSave();
  });

  document.addEventListener("change", (e) => {
    if (e.target.name === "provider") {
      document.querySelectorAll(".provider").forEach((p) => {
        const radio = p.querySelector("input");
        p.classList.toggle("is-active", radio.checked);
      });
      document.querySelectorAll(".fields[data-for]").forEach((f) => {
        f.hidden = f.dataset.for !== e.target.value;
      });
    }
    if (e.target.closest("main")) queueSave();
  });

  $("#visionEnabled").addEventListener("change", (e) => {
    $("#visionFields").hidden = !e.target.checked;
  });

  $("#visionCopy").addEventListener("click", () => {
    $("#visionBaseUrl").value = $("#baseUrl").value;
    $("#visionApiKey").value = $("#apiKey").value;
    queueSave();
    showToast(T("已沿用上面的地址和 Key，再填一下视觉模型名"));
  });

  $("#langSwitch").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-lang]");
    if (!btn) return;
    langPref = btn.dataset.lang;
    queueSave();
    current.lang = langPref;
    applyLangUI();
  });

  $("#grantBtn").addEventListener("click", async () => {
    const raw = $("#baseUrl").value.trim();
    if (!raw) return;
    let origin;
    try {
      origin = new URL(raw).origin + "/*";
    } catch (_) {
      showToast(T("Base URL 格式不对"));
      return;
    }
    const granted = await chrome.permissions.request({ origins: [origin] });
    showToast(granted ? T("已授权 %s", origin) : T("未授权，请求会失败"));
  });

  $("#resetStats").addEventListener("click", async () => {
    await send({ type: "resetStats" });
    refreshStats();
    showToast(T("统计已清零"));
  });

  $("#resetAll").addEventListener("click", async () => {
    if (!confirm(T("恢复默认设置？API Key 和自定义规则都会清空。"))) return;
    await chrome.storage.sync.clear();
    location.reload();
  });

  /* ---------------------------------------------------------------- */
  /* 统计                                                              */
  /* ---------------------------------------------------------------- */

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => resolve(res || {}));
    });
  }

  async function refreshStats() {
    const res = await send({ type: "getState" });
    const s = res.stats || {};
    $("#statClassified").textContent = s.classified || 0;
    $("#statFiltered").textContent = s.filtered || 0;
    $("#statHidden").textContent = s.hidden || 0;
    $("#statFeedback").textContent = s.feedback || 0;
    $("#statErrors").textContent = s.errors || 0;
    $("#lastError").textContent = res.lastError ? "最近一次错误：" + res.lastError.message : "";
    const tu = res.tokenUsage;
    const used = (res.usage && res.usage.count) || 0;
    $("#usageLine").textContent = tu && tu.tokens
      ? `今日 ${used} 次请求 · 约 ${(tu.tokens / 1000).toFixed(1)}k tokens`
      : "";
  }

  /* ---------------------------------------------------------------- */
  /* 试跑                                                              */
  /* ---------------------------------------------------------------- */

  const SAMPLES_ZH = [
    "🔥 三个月从 0 到 10 万粉，我只做对了这 5 件事。评论区扣「1」领完整 SOP，限时免费，手慢无。",
    "刚把注意力机制的 KV cache 改成了分页存储，显存占用降了 40%，代价是首 token 延迟多了 8ms。附压测数据。",
    "这条时间线越来越难看了，真的没人管管吗？我服了，说两句就被喷，爱咋咋地吧。",
  ];
  const SAMPLES_EN = [
    "🔥 0 to 100k followers in 3 months. I only did these 5 things. Comment \"1\" for the full SOP — free for 24 hours.",
    "Switched the KV cache to paged allocation: ~40% less VRAM, at the cost of 8ms extra first-token latency. Benchmarks below.",
    "This timeline is unbearable now. Say one thing and you get dogpiled. Whatever, I'm done.",
  ];
  const samples = () => (globalThis.XF_I18N && globalThis.XF_I18N.getLang() === "en" ? SAMPLES_EN : SAMPLES_ZH);
  let sampleIndex = 0;

  $("#fillSample").addEventListener("click", () => {
    const list = samples();
    sampleIndex = (sampleIndex + 1) % list.length;
    $("#testText").value = list[sampleIndex];
  });

  $("#runTest").addEventListener("click", async () => {
    const text = $("#testText").value.trim();
    if (!text) return;
    const out = $("#testOut");
    out.classList.remove("hidden");
    out.innerHTML = '<div class="test-verdict">判断中…</div>';

    const cfg = collect();
    cfg.enabled = true;

    const imgUrl = $("#testImage").value.trim();
    const res = await send({
      type: "classify",
      item: {
        id: "test-" + Date.now(),
        handle: "tester",
        text: text.slice(0, 900),
        images: imgUrl ? [imgUrl] : [],
      },
      cfg,
    });

    if (!res || res.error) {
      out.innerHTML = "";
      const div = document.createElement("div");
      div.className = "test-verdict";
      div.textContent = T("请求失败：%s", (res && res.error) || T("未知错误"));
      out.appendChild(div);
      return;
    }

    renderTest(out, res, cfg);
  });

  function renderTest(out, res, cfg) {
    out.innerHTML = "";
    const probs = res.probs || {};
    const rows = cfg.rules
      .filter((r) => r.enabled)
      .map((r) => ({ rule: r, p: probs[r.id] || 0 }))
      .sort((a, b) => b.p - a.p);

    rows.forEach(({ rule, p }) => {
      const hit = p >= rule.threshold;
      const row = document.createElement("div");
      row.className = "test-row" + (hit ? " hit" : "");

      const name = document.createElement("span");
      name.textContent = rule.label;

      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.style.width = Math.round(p * 100) + "%";
      if (!hit) fill.style.background = "#9aa7b2";
      bar.appendChild(fill);

      const val = document.createElement("span");
      val.className = "val";
      val.textContent = Math.round(p * 100) + "%";

      row.append(name, bar, val);
      out.appendChild(row);
    });

    const verdict = document.createElement("div");
    verdict.className = "test-verdict";
    const prefix = res.vision ? T("［含图像判断］") : "";
    const en = globalThis.XF_I18N && globalThis.XF_I18N.getLang() === "en";
    if (res.action === "none") {
      verdict.textContent = prefix + (en ? "Verdict: no action, shown normally." : "结论：不处理，正常显示。");
    } else {
      const verb = en
        ? { fold: "folded", dim: "dimmed", hide: "hidden" }[res.action]
        : { fold: "折叠", dim: "淡化", hide: "隐藏" }[res.action];
      verdict.textContent = en
        ? `${prefix}Verdict: ${res.label} (${Math.round(res.prob * 100)}%) → ${verb}`
        : `${prefix}结论：命中 ${res.label}（${Math.round(res.prob * 100)}%）→ ${verb}`;
    }
    out.appendChild(verdict);

    if (res.warning) {
      const warn = document.createElement("div");
      warn.className = "test-verdict warn";
      warn.textContent = "部分步骤失败：" + res.warning;
      out.appendChild(warn);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------------------------------------------------------- */

  load();
})();
