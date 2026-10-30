importScripts("/src/defaults.js");

const D = globalThis.XF_DEFAULTS;
const MAX_RULES = globalThis.XF_MAX_RULES || 10;

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

let cfgCache = null;
let cfgLoadedAt = 0;

async function getCfg() {
  if (cfgCache && Date.now() - cfgLoadedAt < 3000) return cfgCache;
  const stored = await chrome.storage.sync.get(null);
  cfgCache = Object.assign({}, D, stored);
  cfgCache.rules = Array.isArray(stored.rules) && stored.rules.length ? stored.rules : D.rules;
  cfgLoadedAt = Date.now();
  return cfgCache;
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync" || area === "local") {
    cfgCache = null;
    cfgLoadedAt = 0;
  }
});

/* ------------------------------------------------------------------ */
/* 结果缓存（SW 内存 + session storage 双写，防止 SW 休眠后重复计费）      */
/* ------------------------------------------------------------------ */

const mem = new Map();
const MEM_LIMIT = 4000;

function rulesSignature(cfg) {
  // 只把“影响模型判断”的字段放进签名：改动作/阈值不该让缓存失效，
  // 因为动作和阈值是在 decide() 里现算的。
  return cfg.rules
    .filter((r) => r.enabled)
    .map((r) => r.id + ":" + r.label + ":" + r.desc)
    .join("|");
}

function cacheKey(cfg, item) {
  const model =
    cfg.provider === "typesafe"
      ? cfg.typesafeModel
      : cfg.provider === "clef"
      ? cfg.clefModel
      : cfg.model;
  const media = (item.images || [])[0] || "";
  const sig = [cfg.provider, model, rulesSignature(cfg), item.id, media, cfg.visionEnabled].join("::");
  let h = 2166136261;
  for (let i = 0; i < sig.length; i++) {
    h ^= sig.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "jf_" + (h >>> 0).toString(36) + "_" + item.id;
}

async function cacheGet(key) {
  if (mem.has(key)) return mem.get(key);
  try {
    const o = await chrome.storage.session.get(key);
    const v = o[key];
    if (v) {
      mem.set(key, v);
      return v;
    }
  } catch (_) {}
  return null;
}

async function cacheSet(key, value) {
  mem.set(key, value);
  if (mem.size > MEM_LIMIT) {
    const first = mem.keys().next().value;
    mem.delete(first);
  }
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch (_) {}
}

/* ------------------------------------------------------------------ */
/* 分类器                                                              */
/* ------------------------------------------------------------------ */

function activeRules(cfg) {
  return cfg.rules.filter((r) => r.enabled).slice(0, MAX_RULES);
}

function buildState(item) {
  const handle = item.handle ? "@" + item.handle : "未知作者";
  return `作者：${handle}\n帖子内容：\n${item.text || "（无文字，仅图片）"}`;
}

function httpError(service, status, body) {
  const tail = body ? " " + body.slice(0, 120) : "";
  if (status === 451) {
    return new Error(
      service +
        " 451: region unavailable / 当前网络所在地区不可用。Use a proxy, or set a relay endpoint in Settings." +
        tail
    );
  }
  if (status === 401 || status === 403) return new Error(service + " " + status + ": invalid key or no permission / API Key 无效或没有权限" + tail);
  if (status === 402) return new Error(service + " 402: out of credit / 余额不足" + tail);
  if (status === 429) return new Error(service + " 429: rate limited / 触发限流，稍后再试" + tail);
  return new Error(service + " " + status + tail);
}

async function callTypesafe(item, cfg, rules) {
  if (!cfg.typesafeKey) throw new Error("未填写 TypeSafe API Key");
  const questions = {};
  for (const r of rules) {
    questions[r.id] = {
      type: "noul",
      instructions: `这条社交媒体帖子是否属于「${r.label}」这一类？判定标准：${r.desc}`,
    };
  }
  const base = (cfg.typesafeBase || "https://api.typesafe.ai").replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(base + "/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + cfg.typesafeKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.typesafeModel || "jev-latest",
        state: buildState(item),
        questions,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw httpError("TypeSafe", res.status, body);
  }
  const data = await res.json();
  const probs = {};
  for (const r of rules) {
    const a = data.answers && data.answers[r.id];
    probs[r.id] = a && typeof a.noul === "number" ? a.noul : 0;
  }
  return { probs, usage: data.usage || null };
}

/* ------------------------------------------------------------------ */
/* Clef-omni：Cloudflare 的决策模型，和 Jev 同一套 state/questions 协议， */
/* 区别是图片直接放在同一次请求里，不需要再串一个视觉模型。                 */
/* ------------------------------------------------------------------ */

async function callClef(item, cfg, rules) {
  if (!cfg.clefKey) throw new Error("未填写 Cloudflare API Token");
  if (!cfg.clefAccountId) throw new Error("未填写 Cloudflare Account ID");

  const base = (cfg.clefBase || "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");
  const model = cfg.clefModel || "@cf/cloudflare/clef-omni";
  const url = `${base}/accounts/${cfg.clefAccountId}/ai/run/${model}`;

  const images = [];
  for (const u of (item.images || []).slice(0, 2)) {
    try {
      images.push(await imageToDataUrl(u));
    } catch (_) {
      /* 单张失败就跳过 */
    }
  }
  const hasImg = images.length > 0;

  const questions = {};
  for (const r of rules) {
    questions[r.id] = {
      type: "noul",
      instructions:
        `这条社交媒体帖子是否属于「${r.label}」这一类？判定标准：${r.desc}` +
        (hasImg
          ? " 帖子里附了图片，请把图片内容一起看进去（包括图里的文字、二维码、联系方式、合成或涂鸦）。"
          : ""),
    };
  }

  const payload = { model: model.split("/").pop(), state: buildState(item), questions };
  if (hasImg) payload.images = images;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + cfg.clefKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw httpError("Clef", res.status, body);
  }
  const data = await res.json();
  const answers = (data.result && data.result.answers) || data.answers || {};
  const probs = {};
  for (const r of rules) {
    const a = answers[r.id];
    probs[r.id] = a && typeof a.noul === "number" ? a.noul : 0;
  }
  return { probs, usage: (data.result && data.result.usage) || null, usedImage: hasImg };
}

async function callOpenAI(item, cfg, rules) {
  if (!cfg.apiKey) throw new Error("未填写 API Key");
  const base = (cfg.baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("未填写 Base URL");

  const ruleLines = rules
    .map((r) => `- ${r.id}｜${r.label}：${r.desc}`)
    .join("\n");

  const system =
    "你是一个内容分类器，只输出 JSON，不解释。" +
    "给定一条社交媒体帖子，判断它命中下列各类别的概率（0 到 1 的小数，可以是 0.03 这样的细粒度值）。" +
    "只输出一个 JSON 对象，键是类别 id，值是概率。不要输出 markdown 代码块。";

  const user = `类别定义：\n${ruleLines}\n\n帖子：\n${buildState(item)}\n\n输出示例：{"ad":0.02,"bait":0.71}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + cfg.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw httpError("接口", res.status, body);
  }
  const data = await res.json();
  let text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  return { probs: parseProbJson(text, rules), usage: data.usage || null };
}

function parseProbJson(text, rules) {
  let clean = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (_) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("模型没有返回可解析的 JSON");
    parsed = JSON.parse(m[0]);
  }
  const probs = {};
  for (const r of rules) {
    const v = Number(parsed[r.id]);
    probs[r.id] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  }
  return probs;
}

/* ------------------------------------------------------------------ */
/* 图像判断：Jev 不支持图片，这里另走一个视觉模型                          */
/* ------------------------------------------------------------------ */

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function imageToDataUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("图片下载失败 " + res.status);
    const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!type.startsWith("image/")) throw new Error("返回的不是图片");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 4 * 1024 * 1024) throw new Error("图片超过 4MB");
    return `data:${type};base64,${arrayBufferToBase64(buf)}`;
  } finally {
    clearTimeout(timer);
  }
}

async function callVision(item, cfg, rules) {
  const base = (cfg.visionBaseUrl || cfg.baseUrl || "").replace(/\/+$/, "");
  const key = cfg.visionApiKey || cfg.apiKey;
  const model = cfg.visionModel || cfg.model;
  if (!base || !key || !model) throw new Error("图像判断缺少地址 / Key / 模型");

  const limit = Math.max(1, Number(cfg.visionMaxImages) || 1);
  const urls = (item.images || []).slice(0, limit);
  if (!urls.length) return null;

  const ruleLines = rules.map((r) => `- ${r.id}｜${r.label}：${r.desc}`).join("\n");
  const parts = [
    {
      type: "text",
      text:
        `类别定义：\n${ruleLines}\n\n` +
        `请判断这张图片本身（以及配文）是否命中上述类别，注意：图片里的文字、二维码、联系方式、宣传海报都算内容。\n` +
        `配文：${item.text || "（无文字）"}\n` +
        `只输出一个 JSON 对象，键是类别 id，值是 0 到 1 的概率。`,
    },
  ];

  for (const u of urls) {
    try {
      const dataUrl = await imageToDataUrl(u);
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    } catch (_) {
      /* 单张图失败就跳过 */
    }
  }
  if (parts.length === 1) throw new Error("图片下载失败，已跳过图像判断");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是一个内容分类器，只输出 JSON，不解释，不要输出 markdown。" },
          { role: "user", content: parts },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw httpError("视觉接口", res.status, body);
  }
  const data = await res.json();
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  return { probs: parseProbJson(text, rules), usage: data.usage || null };
}

const MOCK_PATTERNS = {
  ad: /链接|下单|优惠|私信|课程|社群|限时|购买|折扣|扫码|link|buy|discount/i,
  bait: /你怎么看|评论区|敢不敢|不服|转发|点赞|同意吗|说说你/i,
  crypto: /空投|代币|合约|仓位|百倍|moon|token|airdrop|USDT/i,
  slop: /干货|建议收藏|十条|底层逻辑|认知|赛道|闭环/i,
  rage: /傻|蠢|滚|垃圾|恶心|闭嘴|idiot|stupid/i,
  lowinfo: /^[\s\S]{0,12}$/,
};

async function callMock(item, _cfg, rules) {
  await new Promise((r) => setTimeout(r, 350 + Math.random() * 450));
  const probs = {};
  for (const r of rules) {
    const re = MOCK_PATTERNS[r.id];
    probs[r.id] = re && re.test(item.text) ? 0.78 + Math.random() * 0.2 : Math.random() * 0.12;
  }
  return { probs, usage: null };
}

function decide(probs, cfg, rules) {
  let best = null;
  for (const r of rules) {
    const p = probs[r.id] || 0;
    const th = typeof r.threshold === "number" ? r.threshold : cfg.threshold;
    if (p >= th && (!best || p > best.prob)) best = { rule: r, prob: p };
  }
  if (!best) return { action: "none" };
  let action = cfg.actionMode === "rule" ? best.rule.action || "fold" : cfg.actionMode;
  if (best.prob < cfg.minActConfidence && action !== "dim") action = "dim";
  return {
    action,
    label: best.rule.label,
    ruleId: best.rule.id,
    prob: Math.round(best.prob * 100) / 100,
  };
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function bumpStats(patch) {
  const o = await chrome.storage.local.get(["stats"]);
  let s = o.stats;
  if (!s || s.date !== today()) s = { date: today(), classified: 0, filtered: 0, hidden: 0, errors: 0, feedback: 0 };
  s.classified += patch.classified || 0;
  s.filtered += patch.filtered || 0;
  s.hidden += patch.hidden || 0;
  s.errors += patch.errors || 0;
  s.feedback = (s.feedback || 0) + (patch.feedback || 0);
  await chrome.storage.local.set({ stats: s });
}

async function recordError(message) {
  await chrome.storage.local.set({ lastError: { message, at: Date.now() } });
  await bumpStats({ errors: 1 });
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

/* 额度冷却：429 且是「每日免费额度用完」时，暂停调用到 UTC 零点，
   避免每一帖都撞一次 429、把错误条刷满屏幕。 */
async function getCooldownUntil() {
  const { cooldownUntil } = await chrome.storage.local.get("cooldownUntil");
  return cooldownUntil && cooldownUntil > Date.now() ? cooldownUntil : 0;
}

function nextUtcMidnight() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5, 0);
}

function isQuotaError(message) {
  return /429/.test(message) && /(free allocation|daily|quota|ration|额度)/i.test(message);
}

async function classify(item, cfgOverride) {
  const cfg = cfgOverride ? Object.assign({}, D, cfgOverride) : await getCfg();
  const rules = activeRules(cfg);
  if (!rules.length) return { action: "none" };
  if (!cfg.enabled) return { action: "none" };

  const cooling = await getCooldownUntil();
  if (cooling) return { action: "none", cooldown: true, until: cooling };

  const key = cacheKey(cfg, item);
  const hit = await cacheGet(key);
  if (hit && hit.probs) {
    // 缓存只存概率，动作/阈值每次按当前配置现算，
    // 这样改「处理方式」或阈值能立刻生效，也不用重复付费。
    const result = decide(hit.probs, cfg, rules);
    result.probs = hit.probs;
    result.provider = cfg.provider;
    result.vision = !!hit.vision;
    result.cached = true;
    return result;
  }

  const hasText = String(item.text || "").replace(/\s/g, "").length >= 4;
  const images = item.images || [];
  const visionReady =
    !!cfg.visionEnabled &&
    cfg.provider !== "mock" &&
    cfg.provider !== "clef" &&
    images.length > 0 &&
    !!(cfg.visionBaseUrl || cfg.baseUrl) &&
    !!(cfg.visionApiKey || cfg.apiKey) &&
    !!(cfg.visionModel || cfg.model);

  // Clef 把图片放在同一次请求里，纯图片帖也能直接判断
  const clefCanSee = cfg.provider === "clef" && images.length > 0;

  // 既没有文字、又没有可用的图像通道：直接跳过，不记为错误
  if (!hasText && !visionReady && !clefCanSee) return { action: "none", skipped: true };

  let probs = {};
  let got = false;
  let visionUsed = false;
  let lastErr = null;

  if (hasText || clefCanSee) {
    try {
      const out =
        cfg.provider === "mock"
          ? await callMock(item, cfg, rules)
          : cfg.provider === "clef"
          ? await callClef(item, cfg, rules)
          : cfg.provider === "openai"
          ? await callOpenAI(item, cfg, rules)
          : await callTypesafe(item, cfg, rules);
      probs = out.probs;
      if (out.usedImage) visionUsed = true;
      got = true;
    } catch (err) {
      lastErr = err;
    }
  }

  if (visionReady) {
    try {
      const v = await callVision(item, cfg, rules);
      if (v) {
        for (const r of rules) probs[r.id] = Math.max(probs[r.id] || 0, v.probs[r.id] || 0);
        got = true;
        visionUsed = true;
      }
    } catch (err) {
      lastErr = lastErr || err;
    }
  }

  if (!got) {
    const message = String((lastErr && lastErr.message) || "没有可判断的内容");
    if (isQuotaError(message)) {
      const until = nextUtcMidnight();
      await chrome.storage.local.set({ cooldownUntil: until, lastError: { at: Date.now(), message } });
      return { action: "none", cooldown: true, until };
    }
    await recordError(message);
    return { action: "none", error: message };
  }

  const result = decide(probs, cfg, rules);
  result.probs = probs;
  result.provider = cfg.provider;
  result.vision = visionUsed;
  if (lastErr) result.warning = String(lastErr.message || lastErr);
  await cacheSet(key, { probs, vision: visionUsed });
  await bumpStats({
    classified: 1,
    filtered: result.action === "none" ? 0 : 1,
    hidden: result.action === "hide" ? 1 : 0,
  });
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === "classify") {
        sendResponse(await classify(msg.item, msg.cfg));
      } else if (msg && msg.type === "ping") {
        const cfg = await getCfg();
        sendResponse({ ok: true, provider: cfg.provider, enabled: cfg.enabled });
      } else if (msg && msg.type === "getState") {
        const cfg = await getCfg();
        const o = await chrome.storage.local.get(["stats", "lastError"]);
        sendResponse({
          ok: true,
          enabled: cfg.enabled,
          provider: cfg.provider,
          ruleCount: activeRules(cfg).length,
          stats: o.stats || null,
          lastError: o.lastError || null,
        });
      } else if (msg && msg.type === "setEnabled") {
        await chrome.storage.sync.set({ enabled: !!msg.value });
        sendResponse({ ok: true });
      } else if (msg && msg.type === "feedback") {
        await bumpStats({ feedback: 1 });
        sendResponse({ ok: true });
      } else if (msg && msg.type === "resetStats") {
        await chrome.storage.local.set({
          stats: { date: today(), classified: 0, filtered: 0, hidden: 0, errors: 0, feedback: 0 },
          lastError: null,
        });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  return true;
});
