# X Semantic Filter

A Chrome extension that folds low-value posts on X in real time — using a **decision model** instead of keyword lists. You describe what you don't want in plain language; every post gets a probability per rule, and anything above your threshold collapses into a one-line bar you can expand at any time.

Bilingual UI (中文 / English), no backend, no analytics.

```
┌─ X timeline ───────────────────────────────────────────┐
│  🧪  Some post you do want to read                      │
│                                                        │
│  ╭────────────────────────────────────────────────╮    │
│  │ ▎ (funnel)  Crypto shilling  91%  Folded  Show │    │
│  ╰────────────────────────────────────────────────╯    │
│                                                        │
│  Another normal post…                                  │
└────────────────────────────────────────────────────────┘
```

## Why a decision model

Chat models generate text; you then parse the text back into a decision. Decision models skip that round trip: you send `state` + typed questions, you get probabilities back. That makes per-post filtering fast (~300–800 ms) and cheap enough to run on every post you scroll past.

This extension supports three backends plus a local mock:

| Provider | What it is | Input | Price |
| --- | --- | --- | --- |
| **Jev** (TypeSafe) | System One decision model | text | $0.042 / 1M input tokens, output free |
| **Clef-omni** (Cloudflare) | Decision model, **native images** | text + image in one request | $0.15 / 1M input tokens |
| **OpenAI-compatible** | DeepSeek, SiliconFlow, DashScope, your gateway | text (+ images via a vision model) | provider's price |
| **Local mock** | Keyword heuristics, no network | — | free |

Jev and Clef-omni share the same `POST {state, questions}` protocol, so switching is a dropdown. Both return `noul` probabilities, which map 1:1 onto "does this post match this rule".

## Features

- **Plain-language rules** — no keyword lists. Add one with a sentence: `不想看房价涨跌的争吵`.
- **Presets** — Spam (ads, engagement bait, crypto shilling, AI slop, rage-bait, low signal) and Hate / political attacks (hostile national rhetoric, hate speech, personal attacks on politicians, incitement, malicious composites, rage-bait).
- **Three actions** — fold (default), dim, hide. Fold keeps a summary bar; dim reveals on hover; hide can be restored from the bottom-left pill.
- **Image checks** — Clef-omni reads images in the same call. With other backends you can attach a vision model; images are downloaded and sent as base64, so the provider never needs to reach `pbs.twimg.com`.
- **Optional feedback** — on high confidence, the extension opens the post's menu and clicks *Not interested in this post* (or *…in this ad* for promoted posts). Home timeline only, max 8 per 10 minutes.
- **Author blocklist** — handles listed here are folded on sight (a "Blocked author" bar you can expand) across home, search and reply threads. Handled locally: no API call, no cost, and scope does not apply to it.
- **Author allowlist** — skipped entirely, nothing is sent to the model.
- **Agent API** — `window.XFAgent` on the settings page, plus JSON import/export. See [AGENT.md](AGENT.md).
- **Bilingual UI** — 中 / EN toggle in the header, follows the browser by default.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → select this folder (the one containing `manifest.json`).
3. Click the extension icon → **Settings**.

Works in Chrome, Edge, and other Chromium browsers (including agent-oriented Chromium builds such as ego lite).

## Configure

### Jev (TypeSafe)

1. Create a key at <https://console.typesafe.ai/keys> (a card and a $25 prepayment are currently required).
2. Paste it into **TypeSafe API Key**, keep the model at `jev-latest`.
3. If a test run returns **451**, your egress IP is region-blocked — route the browser through a proxy, or point **Endpoint** at your own relay (see [`relay/`](relay/)).

### Clef-omni (Cloudflare) — supports images

1. Copy your **Account ID** from the Cloudflare dashboard.
2. Create an API token with **Workers AI** permission.
3. Model stays `@cf/cloudflare/clef-omni`.

Requests go to `/accounts/<ID>/ai/run/@cf/cloudflare/clef-omni`. Images ride along in the same request as base64, which is why this backend needs no separate vision model.

### OpenAI-compatible

| Service | Base URL | Model |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-flash` |

Click **Grant access** after entering the host — the extension requests the origin explicitly.

## How it works

```
x.com
 └─ content.js
     ├─ MutationObserver picks up article[data-testid="tweet"]
     ├─ extracts id / author / text (incl. quotes) / image URLs
     ├─ queue: 5 in flight, 150 ms batching
     └─ on hit: sets data-xf-action="fold|dim|hidden|expanded" and injects a summary bar
 └─ background.js (service worker)
     ├─ text → Jev / Clef-omni / OpenAI-compatible
     ├─ image → same request (Clef) or a separate vision call
     ├─ probability cache keyed by post id + rule signature
     └─ stats / error mapping (451, 401, 402, 429)
```

Two implementation notes that matter if you hack on this:

- **State lives in `data-xf-action`, not classes.** X rewrites `className` on hover and on re-render; any class you add gets wiped within milliseconds. Data attributes survive.
- **The cache stores probabilities only.** Actions and thresholds are recomputed per request, so changing "what to do" takes effect immediately without paying for the model twice.

## Rules

A rule is `{ label, desc, action, threshold, enabled }`. `desc` is the criterion the model reads, so write observable behaviour rather than conclusions:

> Posts that argue about housing prices with insults or sarcasm. Factual reporting or data-driven analysis does not count.

Tips:

1. One rule = one judgement.
2. Include a counter-example — it cuts false positives more than any positive description.
3. Start at 0.72, adjust by 0.05 after a day of real feed.
4. Any language works; the model judges meaning, not tokens.

## Agent API

The settings page exposes `window.XFAgent`:

```js
await XFAgent.addRuleFromText("不想看房价涨跌的争吵");
await XFAgent.setConfig({ actionMode: "dim", feedbackThreshold: 0.92 });
await XFAgent.applyPreset("political");
```

Full method table, rule schema, and safety conventions: [AGENT.md](AGENT.md).



## Cost control

Every post used to resend all rule descriptions, which made the rules longer than the post itself. The current version is built around cutting that:

- **Compact prompts** — the task sentence is sent once in `state`; each question is just `「label」criterion`. Body text is capped at 700 characters.
- **Persistent cache** — results are keyed by normalised text + first image and stored in `chrome.storage.local` for 7 days, so restarting the browser doesn't re-bill every post you already scrolled past.
- **Images only when relevant** — attached only if an enabled rule mentions images *and* the caption is 40 characters or shorter (or the post is image-only). Malicious imagery tends to travel in memes and one-liners; long posts are judged on text.
- **Daily request cap** — default 500/day. When reached, classification pauses until local midnight instead of silently draining the quota by noon.

Measured on a 60-character post with 8 rules: request body dropped ~19% (more on long posts); identical reposts cost 0 extra calls; a post with an image and no image rule sends ~600 fewer tokens.

## Quota and rate limits

Decision models are billed per input token, so a long timeline can hit a daily cap — Cloudflare's free Workers AI allocation (10k Neurons/day) runs out fastest with many rules plus images. When the provider returns `429` with a quota message, the extension **pauses itself until the next UTC midnight** instead of retrying on every post, and shows a single dismissible notice. Nothing else breaks; folding resumes automatically.

To stretch the quota: fewer rules, `Images per post = 1`, or switch to Jev (roughly 3.5× cheaper on text).

## Privacy

- **No backend.** Requests go from your browser straight to the provider you configure.
- **Keys stay local** in `chrome.storage.sync` on your device.
- **Post text and images leave your browser** when a post is classified. Don't run it on a timeline whose content you can't share with that provider.
- **No telemetry, no analytics, no remote config.**

## Cost

Per ~200-character post, 8 rules (~350–500 input tokens):

| Backend | 1,000 posts | Latency |
| --- | --- | --- |
| Jev | ≈ $0.015 | 300–500 ms |
| Clef-omni (text) | ≈ $0.075 | 300–800 ms |
| Clef-omni (1 image) | ≈ $0.12 | +0.5–1.5 s |
| DeepSeek | ≈ ¥1 | 1–3 s |

Caching means each post is charged once, even across reloads.

## Development

No build step — plain MV3, plain JS.

- `test/mock-x.html` — a fake timeline with stubbed `chrome.*` APIs. Open it in any Chromium browser to try folding without installing anything.
- After editing, hit **Reload** on `chrome://extensions` and refresh X. Content scripts already injected into open tabs do not pick up changes.
- All DOM selectors live at the top of `src/content.js`.

## Limitations

- Web only; the mobile app is not supported.
- Video, GIFs and polls are not classified. Video-only posts are skipped.
- Semantic filtering always misfires sometimes. Folded posts are never deleted.
- X redesigns can break selectors; they're isolated in one place for that reason.
- Hate / political rules are subjective by nature. Prefer **fold** over **hide**, and review what got folded now and then — a filter that quietly removes legitimate criticism leaves you with a worse feed, not a better one.

## License

MIT — see [LICENSE](LICENSE).

[中文说明](README.zh-CN.md)
