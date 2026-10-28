# AGENT.md — driving the extension from an AI agent

The settings page exposes a small, stable JS API on `window.XFAgent`. Any agent that can evaluate JavaScript in that page (Claude Code, Codex, Cursor, Playwright, ego-browser, DevTools console) can read and write the configuration without guessing at the DOM.

Open:

```
chrome-extension://<EXTENSION_ID>/src/options.html
```

Find the ID at `chrome://extensions` → *X Semantic Filter* → ID.

## Quick start

```js
// Read everything
const cfg = await XFAgent.getConfig();

// Add a rule from one sentence (recommended)
await XFAgent.addRuleFromText("不想看房价涨跌的争吵");

// Add a structured rule
await XFAgent.addRule({
  label: "Regional flame wars",
  desc: "Posts that use region or hometown to start a fight and contain no factual information. Ordinary regional news does not count.",
  action: "fold",      // fold | dim | hide
  threshold: 0.74,
  enabled: true,
});

// Change how hits are displayed
await XFAgent.setConfig({ actionMode: "dim", threshold: 0.78, feedbackEnabled: false });

// Apply a built-in preset
await XFAgent.applyPreset("political");   // spam | political

// Bulk
const json = XFAgent.exportRules();
await XFAgent.importRules(json);
```

## API

| Method | Description |
| --- | --- |
| `getConfig()` | Full config, including `rules` |
| `setConfig(patch)` | Shallow merge, saves and re-renders |
| `addRule(rule)` | Append one rule, returns it |
| `addRuleFromText(text, opts?)` | Build a rule from natural language; `opts` may set `label` / `action` / `threshold` |
| `removeRule(id)` | Delete by id, returns remaining rules |
| `applyPreset(name)` | `spam` or `political` |
| `listPresets()` | Available preset names |
| `exportRules()` | Rules as a JSON string |
| `importRules(jsonOrArray)` | Overwrite all rules |

Rule shape:

```json
{
  "id": "r_xxx",
  "label": "Short label shown on the folded bar",
  "desc": "Natural-language criterion the model reads",
  "action": "fold",
  "threshold": 0.72,
  "enabled": true
}
```

Maximum 12 rules. `id` is generated when omitted.

## Writing rules that work

1. Describe observable behaviour, not a verdict. "No concrete facts, only rhetorical lists" beats "this is garbage".
2. One judgement per rule. Mixing topics makes the probability uninterpretable.
3. Include a counter-example — it reduces false positives more than any positive wording.
4. Start at 0.72. Don't jump to 0.9 on day one.
5. Any language works; the model judges meaning.

## Safety conventions

- Never silently delete a user's existing rules; prefer `addRule` / `setConfig`.
- Don't switch `actionMode` to `hide` unless the user asked for it. Fold is the safe default.
- `feedbackEnabled` triggers real clicks on X ("Not interested"). Confirm with the user before toggling it on.
- Call `exportRules()` before a bulk `importRules()` so the change is reversible.
- Reload the X tab after changing rules — already-injected content scripts keep their old config until the page refreshes.

## Without JS access

Settings → **Filter rules** → *For AI agents: import / export rules as JSON*. Paste an array, click **Import & overwrite**.

---

## 中文速览

设置页暴露 `window.XFAgent`，支持 `getConfig` / `setConfig` / `addRule` / `addRuleFromText` / `removeRule` / `applyPreset` / `exportRules` / `importRules`。规则上限 12 条，`desc` 写可观察特征并带反例，阈值从 0.72 起步。不要静默删用户规则、不要擅自把动作改成「隐藏」、`feedbackEnabled` 会在 X 上真实点击「不感兴趣」，改动前先确认。
