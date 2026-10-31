/**
 * 极简双语层：中文原文做 key，英文做 value。
 * 静态文案靠遍历文本节点替换，动态文案用 XF_T("中文")。
 * 好处是不用给每个标签加 data-i18n，也不会破坏现有 DOM 结构。
 */
(function () {
  const EN = {
    // ---- 顶栏 ----
    "X 语义过滤器": "X Semantic Filter",
    "X 语义过滤器 · 设置": "X Semantic Filter · Settings",
    "用自然语言规则实时折叠时间线里的低价值内容":
      "Fold low-value posts on your timeline with plain-language rules",
    "启用": "On",
    "中": "中",
    "EN": "EN",

    // ---- 引擎 ----
    "判断引擎": "Decision engine",
    "每条帖子都会交给模型做一次「是否命中某类内容」的判断。Jev 最快最便宜；国内网络或支付不便时可用 OpenAI 兼容接口。":
      "Every post is sent to a model for one question: does it match any of your categories? Jev is fastest and cheapest; use an OpenAI-compatible endpoint if you prefer.",
    "推荐": "Recommended",
    "TypeSafe 的 System One 模型，单次判断约 300–500ms，$0.042/百万输入 token，输出不计费。":
      "TypeSafe's System One model. ~300–500 ms per decision, $0.042 per 1M input tokens, output is free.",
    "支持图片": "Images",
    "Cloudflare 决策模型，一次请求连图带文，$0.15/百万输入 token，输出不计费。":
      "Cloudflare's decision model. Text and images in one request, $0.15 per 1M input tokens, output is free.",
    "OpenAI 兼容接口": "OpenAI-compatible API",
    "DeepSeek、硅基流动、阿里百炼、自建代理等。延迟 1–3 秒，按各自价格计费。":
      "DeepSeek, SiliconFlow, DashScope, or your own gateway. 1–3 s latency, billed by the provider.",
    "本地模拟": "Local mock",
    "不联网，用关键词假装判断，只用来确认界面和折叠效果。":
      "No network. Keyword heuristics only, for previewing the UI and fold behaviour.",

    "模型": "Model",
    "在 console.typesafe.ai/keys 创建。目前注册后需绑定信用卡并预付 $25 才能生成 Key，早期赠送额度已取消。":
      "Create one at console.typesafe.ai/keys. A card and a $25 prepayment are currently required; the old signup credit is gone.",
    "保持 jev-latest 即可，会自动指向最新版本（当前 1.13.x）。":
      "Keep jev-latest — it always resolves to the newest build (1.13.x at the time of writing).",
    "接口地址": "Endpoint",
    "默认 api.typesafe.ai。若试跑返回 451 / 地区不可用，说明当前出口 IP 被挡：让浏览器整体走代理（PAC 里要包含这个域名），或在这里填你自己的中转地址。":
      "Defaults to api.typesafe.ai. A 451 (region unavailable) means your egress IP is blocked: route the whole browser through a proxy, or put your own relay URL here.",
    "Cloudflare 控制台右侧栏「账户 ID」即可复制。请求地址形如 /accounts/<ID>/ai/run/@cf/cloudflare/clef-omni。":
      "Copy the Account ID from the right sidebar of the Cloudflare dashboard. Requests go to /accounts/<ID>/ai/run/@cf/cloudflare/clef-omni.",
    "Token 需要有 Workers AI 权限。和 Jev 不同，这个模型是决策接口，不是 chat/completions。":
      "The token needs Workers AI permission. Unlike chat models, this one is a decision endpoint, not /chat/completions.",
    "默认 @cf/cloudflare/clef-omni；也可以用 @cf/cloudflare/clef（不支持图片）。":
      "Defaults to @cf/cloudflare/clef-omni; @cf/cloudflare/clef also works but is text-only.",
    "授权访问": "Grant access",
    "填写到 /v1 为止，程序会自动请求 /chat/completions。换域名后需要点一次「授权访问」。":
      "Stop at /v1 — the extension appends /chat/completions. Click Grant access after changing the host.",
    "API Key": "API key",
    "模型名": "Model name",
    "建议用便宜且支持 JSON 输出的模型，例如 deepseek-chat、Qwen/Qwen2.5-7B-Instruct、qwen-flash。":
      "Use a cheap model that supports JSON output: deepseek-chat, Qwen/Qwen2.5-7B-Instruct, qwen-flash.",

    // ---- 图像 ----
    "图像判断": "Image checks",
    "可选": "Optional",
    "Jev 只吃文字，看不见图。开启后，带图的帖子会把图片下载下来，交给另一个支持视觉的模型判断——纯图片帖、海报二维码、图片里的字都能被识别。图片请求会单独计费。":
      "Jev is text-only. When enabled, images are downloaded and sent to a vision model — so image-only posts, QR codes on posters, and text inside images all get judged. Billed separately.",
    "开启图像判断（需要下面这套配置，可以和上面的引擎不同）":
      "Enable image checks (needs the config below; may differ from the engine above)",
    "已开启，但地址 / Key / 模型还没填全，带图帖会被直接跳过（不报错）。":
      "Enabled, but endpoint / key / model is incomplete. Posts with images are skipped silently.",
    "沿用上方接口": "Reuse endpoint above",
    "必须支持 image_url 多模态输入。阿里百炼、硅基流动、OpenAI、智谱都行。":
      "Must support image_url multimodal input. DashScope, SiliconFlow, OpenAI and Zhipu all work.",
    "视觉模型名": "Vision model",
    "例如 qwen-vl-plus、glm-4.5v、gpt-4o-mini。小模型就够用，判断任务不需要强推理。":
      "e.g. qwen-vl-plus, glm-4.5v, gpt-4o-mini. Small models are enough — this is classification, not reasoning.",
    "每条帖子最多看几张图": "Images per post",
    "1 张（推荐，最省）": "1 (recommended, cheapest)",
    "2 张（四宫格更准）": "2 (better for grids)",

    // ---- 规则 ----
    "过滤规则": "Filter rules",
    "用自然语言描述「你不想要什么」。模型按语义判断，不需要你列举关键词。最多 10 条，每条独立判断，不互相干扰。":
      "Describe what you don't want in plain language. The model judges meaning, so no keyword lists. Up to 12 rules, each evaluated independently.",
    "一句话说清你不想看什么，例如：不想看房价涨跌的争吵":
      "One sentence: what do you not want to see? e.g. endless housing-price arguments",
    "添加规则": "Add rule",
    "直接用你的原话当判定标准，模型按语义判断，不用列举关键词。":
      "Your sentence becomes the criterion. No keyword lists needed.",
    "快速载入": "Presets",
    "垃圾信息": "Spam",
    "仇恨 / 政治攻击": "Hate / political attacks",
    "会替换全部规则；图片类规则需开启「图像判断」":
      "Replaces all rules. Image rules need Image checks enabled.",
    "+ 新增规则": "+ New rule",
    "给 AI Agent 用：导入 / 导出规则 JSON": "For AI agents: import / export rules as JSON",
    "能操作这个页面的 Agent 也可以直接调用 window.XFAgent，接口说明见项目里的 AGENT.md。":
      "Agents that can run JS here can call window.XFAgent directly. See AGENT.md.",
    "导出当前规则": "Export rules",
    "导入并覆盖": "Import & overwrite",

    // ---- 行为 ----
    "行为": "Behaviour",
    "被判定命中的帖子怎么处理。": "What happens to posts that match.",
    "处理方式": "Action",
    "按每条规则各自的设定": "Per rule (as configured)",
    "全部折叠（保留一行提示）": "Fold everything (keep a summary bar)",
    "全部淡化（鼠标悬停恢复）": "Dim everything (reveal on hover)",
    "全部隐藏（可从左下角恢复）": "Hide everything (restore from bottom-left)",
    "生效范围": "Scope",
    "所有时间线（首页 / 列表 / 搜索 / 详情页回复）":
      "All timelines (home, lists, search, replies)",
    "只处理首页时间线": "Home timeline only",
    "默认阈值": "Default threshold",
    "概率高于阈值才处理。调高更保守、漏掉更多；调低更激进、误伤更多。":
      "Only act above this probability. Higher = safer but misses more; lower = catches more but misfires.",
    "动作门槛": "Action floor",
    "概率低于该值时最多只淡化，绝不折叠或隐藏，用于压住误判。":
      "Below this probability the post is only dimmed, never folded or hidden. Keeps false positives quiet.",
    "高置信度时，自动在 X 上点「对此帖子不感兴趣」":
      "On high confidence, click “Not interested in this post” on X for you",
    "反馈阈值": "Feedback threshold",
    "只在首页时间线生效，每 10 分钟最多 8 条。这一步是喂给 X 的推荐算法，让「为你推荐」少推同类内容；关掉不影响折叠。":
      "Home timeline only, max 8 per 10 minutes. This trains X's recommender so “For you” shows less of it. Turning it off does not affect folding.",
    "作者屏蔽名单": "Blocked authors",
    "每行一个账号，不带 @。命中后直接隐藏，不调用模型。":
      "One handle per line, without @. Matches are hidden locally.",
    "这些账号的帖子和回复会从时间线上直接消失，本地处理、不花钱、不受「生效范围」限制。":
      "Posts and replies from these accounts disappear from your timeline — local only, no API cost, regardless of scope.",
    "屏蔽": "blocked",
    "屏蔽作者": "Blocked author",
    "已屏蔽": "Blocked",
    "作者白名单": "Author allowlist",
    "每行一个账号，不带 @。例如：\nlevelsio\nsimonw":
      "One handle per line, without @. e.g.\nlevelsio\nsimonw",
    "白名单里的作者会被直接跳过，不发送任何内容给模型。":
      "Allowlisted authors are skipped entirely — nothing is sent to the model.",

    // ---- 试跑 ----
    "试跑": "Test bench",
    "先用几段文字验证规则写得准不准，再去刷时间线。这一步会真实调用接口并计费（一次约几分钱都不到）。":
      "Check your rules on sample text before scrolling. This calls the real API and is billed (well under a cent per run).",
    "测试文本": "Test text",
    "图片 URL（可选，验证图像判断）": "Image URL (optional, tests image checks)",
    "只有开启图像判断时才生效。填一张公开可访问的图片地址即可，扩展会先下载再发给视觉模型。":
      "Only used when image checks are on. Paste any public image URL; the extension downloads it before calling the vision model.",
    "运行判断": "Run",
    "换一条示例": "Another sample",

    // ---- 统计 ----
    "今日统计": "Today",
    "已判断": "Classified",
    "已过滤": "Filtered",
    "隐藏": "Hidden",
    "回传 X": "Feedback",
    "出错": "Errors",
    "清零": "Reset",
    "恢复默认设置": "Restore defaults",

    // ---- 说明 ----
    "使用前请知悉": "Before you start",
    "帖子正文会发送到你配置的模型服务商；开启图像判断后，图片也会一起发出去。本扩展没有自建服务器，也没有中转。":
      "Post text is sent to the provider you configure; with image checks on, images go too. There is no backend server and no relay.",
    "视频、GIF、投票不参与判断；纯视频帖会被跳过，纯图片帖在开启图像判断后才会被处理。":
      "Video, GIFs and polls are ignored. Video-only posts are skipped; image-only posts are handled only when image checks are on.",
    "语义判断一定有误伤。默认只折叠不删除，折叠的帖子随时可以展开。":
      "Semantic filtering always misfires sometimes. Folded posts are never deleted and can be expanded at any time.",
    "X 改版可能导致选择器失效，规则里所有 DOM 选择器集中在 src/content.js 顶部。":
      "X redesigns can break selectors. All of them live at the top of src/content.js.",

    // ---- 弹窗 ----
    "读取中…": "Loading…",
    "打开设置": "Settings",
    "刷新 X": "Reload X",
    "已停用": "Disabled",

    // ---- 时间线上的动态文案 ----
    "已折叠": "Folded",
    "低信号": "Low signal",
    "已隐藏": "Hidden",
    "展开": "Show",
    "收起": "Hide",
    "显示全部": "Show all",
    "恢复过滤": "Re-apply",
    "语义过滤 · ": "Filtered · ",
    "折叠": "folded",
    "淡化": "dimmed",
    "过滤器请求失败：": "Filter request failed: ",
    "模型额度用完，过滤已暂停，%s 后自动恢复": "Model quota exhausted — filtering paused until %s",
    "今日请求已达上限（%n 条），明天自动恢复": "Daily request cap reached (%n) — resuming tomorrow",
    "每日请求上限": "Daily request cap",
    "超过后暂停到次日 0 点，避免把免费额度一次用完。0 = 不限制。":
      "Pauses until midnight once reached, so a free quota lasts the day. 0 = unlimited.",
    "关闭": "Close",

    // ---- 动态提示 ----
    "已保存": "Saved",
    "最多 %n 条规则": "Up to %n rules",
    "已载入「%s」预设": "Preset applied: %s",
    "已添加规则：%s": "Rule added: %s",
    "已导出到下方文本框": "Exported to the box below",
    "已导入 %n 条规则": "Imported %n rules",
    "JSON 解析失败：%s": "Invalid JSON: %s",
    "Base URL 格式不对": "Base URL is not valid",
    "未授权，请求会失败": "Permission denied — requests will fail",
    "已授权 %s": "Granted %s",
    "统计已清零": "Stats reset",
    "已沿用上面的地址和 Key，再填一下视觉模型名":
      "Endpoint and key copied — now fill in the vision model name",
    "用自然语言描述这类内容长什么样，越具体越准。":
      "Describe what this kind of content looks like. The more specific, the better.",
    "新规则": "New rule",
    "删除": "Delete",
    "命中后": "When matched",
    "阈值": "Threshold",
    "折叠帖子": "Fold",
    "淡化帖子": "Dim",
    "隐藏帖子": "Hide",
    "未命名": "Untitled",
    "恢复默认设置？API Key 和自定义规则都会清空。":
      "Restore defaults? API keys and custom rules will be cleared.",
    "用「%s」预设替换当前 %n 条规则？": "Replace all %n rules with the “%s” preset?",
    "只处理文字，图片、视频、投票不参与判断；纯图片帖会被跳过。":
      "Text only; images, video and polls are ignored.",
    "结论：命中 %s（%d%%）→ %s": "Verdict: %s (%d%%) → %s",
    "结论：不处理，正常显示。": "Verdict: no action, shown normally.",
    "［含图像判断］": "[with image checks] ",
    "部分步骤失败：%s": "Some steps failed: %s",
    "判断中…": "Running…",
    "请求失败：%s": "Request failed: %s",
    "未知错误": "unknown error",
  };


  // 含 <code>/<a> 的段落：整段 HTML 替换，避免文本节点被标签切碎后翻不到
  const EN_HTML = {
    ts_key:
      'Create one at <a href="https://console.typesafe.ai/keys" target="_blank" rel="noreferrer">console.typesafe.ai/keys</a>. A card and a $25 prepayment are currently required; the old signup credit is gone.',
    ts_model:
      "Keep <code>jev-latest</code> — it always resolves to the newest build (1.13.x at the time of writing).",
    ts_base:
      "Defaults to <code>https://api.typesafe.ai</code>. A <b>451 / region unavailable</b> means your egress IP is blocked: route the whole browser through a proxy, or put your own relay URL here.",
    clef_id:
      "Copy the Account ID from the right sidebar of the Cloudflare dashboard. Requests go to <code>/accounts/&lt;ID&gt;/ai/run/@cf/cloudflare/clef-omni</code>.",
    clef_model:
      "Defaults to <code>@cf/cloudflare/clef-omni</code>; <code>@cf/cloudflare/clef</code> also works but is text-only.",
    oa_base:
      "Stop at <code>/v1</code> — the extension appends <code>/chat/completions</code>. Click Grant access after changing the host.",
    oa_model:
      "Use a cheap model that supports JSON output, e.g. <code>deepseek-chat</code>, <code>Qwen/Qwen2.5-7B-Instruct</code>, <code>qwen-flash</code>.",
    vis_base:
      "Must support <code>image_url</code> multimodal input. DashScope, SiliconFlow, OpenAI and Zhipu all work.",
    vis_model:
      "e.g. <code>qwen-vl-plus</code>, <code>glm-4.5v</code>, <code>gpt-4o-mini</code>. Small models are enough — this is classification, not reasoning.",
    agent_hint:
      "Agents that can run JS here can call <code>window.XFAgent</code> directly. See <code>AGENT.md</code>.",
    note_sel:
      "X redesigns can break selectors. All of them live at the top of <code>src/content.js</code>.",
  };

  let lang = "zh";

  const origText = new WeakMap();
  const origPlaceholder = new WeakMap();
  const origTitle = new WeakMap();
  const origHtml = new WeakMap();

  function setLang(next, opts) {
    lang = next === "en" ? "en" : "zh";
    if (typeof document !== "undefined" && !(opts && opts.silent)) {
      document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
      if (document.body) applyI18n(document.body);
      const title = document.querySelector("title");
      if (title) {
        if (!origTitle.has(title)) origTitle.set(title, title.textContent);
        const orig = origTitle.get(title);
        title.textContent = lang === "en" ? EN[orig] || orig : orig;
      }
    }
    return lang;
  }

  function detectLang(pref) {
    if (pref === "zh" || pref === "en") return pref;
    const nav = (typeof navigator !== "undefined" && navigator.language) || "zh";
    return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function getLang() {
    return lang;
  }

  /** 取当前语言的文案；支持 %s / %n / %d 占位 */
  function t(zh, ...args) {
    let out = zh;
    if (lang === "en" && EN[zh]) out = EN[zh];
    if (!args.length) return out;
    let i = 0;
    return out.replace(/%[snd]/g, () => String(args[i++]));
  }

  function applyI18n(root) {
    if (!root || !root.ownerDocument) return;
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "CODE" || tag === "TEXTAREA") {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (!origText.has(node)) origText.set(node, node.nodeValue);
      const orig = origText.get(node);
      const key = orig.trim();
      if (!key) continue;
      node.nodeValue = lang === "en" && EN[key] ? orig.replace(key, EN[key]) : orig;
    }

    root.querySelectorAll("[data-i18n]").forEach((el) => {
      if (!origHtml.has(el)) origHtml.set(el, el.innerHTML);
      const orig = origHtml.get(el);
      const key = el.dataset.i18n;
      el.innerHTML = lang === "en" && EN_HTML[key] ? EN_HTML[key] : orig;
    });

    root.querySelectorAll("[placeholder]").forEach((el) => {
      if (!origPlaceholder.has(el)) origPlaceholder.set(el, el.getAttribute("placeholder"));
      const orig = origPlaceholder.get(el);
      const key = orig.trim();
      el.setAttribute("placeholder", lang === "en" && EN[key] ? EN[key] : orig);
    });
  }

  globalThis.XF_T = t;
  globalThis.XF_I18N = { setLang, getLang, detectLang, applyI18n, t, dict: EN };
})();
