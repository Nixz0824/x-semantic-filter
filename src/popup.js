(function () {
  const $ = (s) => document.querySelector(s);

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => resolve(res || {}));
    });
  }

  const PROVIDER_NAME = {
    typesafe: "Jev · TypeSafe",
    clef: "Clef-omni",
    openai: "OpenAI 兼容接口",
    mock: "本地模拟",
  };

  (async () => {
    const cfg = await new Promise((r) => chrome.storage.sync.get(["lang"], r));
    if (globalThis.XF_I18N) {
      globalThis.XF_I18N.setLang(globalThis.XF_I18N.detectLang(cfg.lang));
      globalThis.XF_I18N.applyI18n(document.body);
    }
  })();

  async function refresh() {
    const res = await send({ type: "getState" });
    const s = res.stats || {};
    $("#enabled").checked = !!res.enabled;
    $("#s1").textContent = s.classified || 0;
    $("#s2").textContent = s.filtered || 0;
    $("#s3").textContent = s.errors || 0;
    const t = (zh) => (globalThis.XF_T ? globalThis.XF_T(zh) : zh);
    const pname = PROVIDER_NAME[res.provider] || res.provider;
    const name = res.provider === "openai" ? t("OpenAI 兼容接口") : res.provider === "mock" ? t("本地模拟") : pname;
    $("#state").textContent = res.enabled
      ? name + " · " + (res.ruleCount || 0) + (globalThis.XF_I18N && XF_I18N.getLang() === "en" ? " rules" : " 条规则")
      : t("已停用");
    $("#foot").textContent = res.lastError ? "最近错误：" + res.lastError.message.slice(0, 90) : "";
  }

  $("#enabled").addEventListener("change", async (e) => {
    await send({ type: "setEnabled", value: e.target.checked });
    refresh();
  });

  $("#open").addEventListener("click", () => chrome.runtime.openOptionsPage());

  $("#refresh").addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    let isX = false;
    try {
      isX = !!(tab && tab.url) && /(^|\.)(x|twitter)\.com$/.test(new URL(tab.url).hostname);
    } catch (_) {}
    if (isX) chrome.tabs.reload(tab.id);
    else chrome.tabs.create({ url: "https://x.com/home" });
    window.close();
  });

  refresh();
})();
