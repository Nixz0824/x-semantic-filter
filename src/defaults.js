/* 全局默认配置。content script / background / options 三处共用，避免各写一份。 */
(function () {
  const DEFAULTS = {
    enabled: true,
    // 界面语言：auto = 跟随浏览器，zh = 中文，en = English
    lang: "auto",

    // typesafe = Jev（最快最便宜，需要 TypeSafe 账号）
    // clef     = Cloudflare Clef-omni（决策模型，原生支持图片，一次请求连图带文）
    // openai   = 任意 OpenAI 兼容接口（DeepSeek / 硅基流动 / 阿里百炼 / 自建代理）
    // mock     = 本地关键词模拟，不联网，仅用于调试界面
    provider: "typesafe",

    typesafeKey: "",
    typesafeModel: "jev-latest",
    // 官方地址被地域限制（HTTP 451）时，可以填自己的中转 / Worker 地址
    typesafeBase: "https://api.typesafe.ai",

    clefAccountId: "",
    clefKey: "",
    clefModel: "@cf/cloudflare/clef-omni",
    clefBase: "https://api.cloudflare.com/client/v4",

    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",

    // 图像判断：Jev 只吃文字，图片必须另配一个支持视觉的 OpenAI 兼容模型
    visionEnabled: false,
    visionBaseUrl: "",
    visionApiKey: "",
    visionModel: "",
    visionMaxImages: 1,

    // 全局兜底阈值，规则里没有单独设置时用它
    threshold: 0.7,
    // rule = 按每条规则自己设定的动作；否则强制统一为 fold / hide / dim
    actionMode: "rule",
    // home = 只处理首页时间线；all = 首页 + 列表 + 搜索 + 个人页
    scope: "all",
    // 作者白名单，命中直接跳过（不带 @）
    allowlist: [],
    // 作者黑名单：命中就直接隐藏，不送模型。填 @handle 或 handle 都行。
    blocklist: [],
    // 置信/概率低于该值只淡化，绝不折叠，用来压误伤
    minActConfidence: 0.6,

    // 高置信度命中后，顺手替你在 X 上点「对此帖子不感兴趣」，
    // 让推荐算法也少推这类内容。只在首页生效，且有频率上限。
    // 每天最多发多少次真实请求（0 = 不限制）。防止一个上午把免费额度烧光。
    dailyBudget: 500,
    // 发给模型的正文上限（字符）。越长越贵，700 足够判断语气。
    maxChars: 700,
    feedbackEnabled: true,
    feedbackThreshold: 0.9,

    rules: [
      {
        id: "ad",
        label: "广告 / 带货",
        desc:
          "在推销商品、课程、社群、服务或自己的账号，通常带购买链接、优惠码、私信领取、限时名额。单纯分享自己用过的东西、或推荐免费资源不算。",
        action: "fold",
        threshold: 0.72,
        enabled: true,
      },
      {
        id: "bait",
        label: "诱导互动",
        desc:
          "故意挑衅、制造对立、卖关子、只为了骗点赞评论转发；正文几乎没有实质信息，读完只想吵架或回复。",
        action: "fold",
        threshold: 0.72,
        enabled: true,
      },
      {
        id: "crypto",
        label: "币圈喊单",
        desc:
          "推荐具体代币、合约点位、空投、暴富叙事，或拉人进群、晒收益截图。",
        action: "fold",
        threshold: 0.7,
        enabled: true,
      },
      {
        id: "slop",
        label: "AI 水文",
        desc:
          "模板化排比、空洞鸡汤、堆砌形容词，没有具体事实、数据、案例或可验证细节的「干货清单」。",
        action: "fold",
        threshold: 0.7,
        enabled: true,
      },
      {
        id: "rage",
        label: "情绪对骂",
        desc:
          "人身攻击、嘲讽、站队互撕，主要在发泄情绪而不是传递信息。批评观点但给出论据的不算。",
        action: "fold",
        threshold: 0.78,
        enabled: true,
      },
      {
        id: "lowinfo",
        label: "低信息量",
        desc: "纯转发、纯表情、一句话没有上下文、只有链接或只有图没有文字说明。",
        action: "dim",
        threshold: 0.75,
        enabled: true,
      },
    ],
  };

  const MAX_RULES = 12;

  globalThis.XF_DEFAULTS = DEFAULTS;
  globalThis.XF_MAX_RULES = MAX_RULES;
})();
