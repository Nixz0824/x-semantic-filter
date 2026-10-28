/**
 * TypeSafe 中转 Worker
 *
 * 用途：你的出口 IP 在中国大陆时，api.typesafe.ai 会直接返回 451。
 * 这个 Worker 跑在 Cloudflare 边缘节点上（境外），替你把请求转发过去。
 *
 * 部署：
 *   1. npm i -g wrangler && wrangler login
 *   2. wrangler deploy worker.js --name jev-relay
 *   3. 把拿到的 https://jev-relay.<你的子域>.workers.dev 填进扩展的「接口地址」
 *
 * 说明：
 *   - 不存 Key。扩展发来的 Authorization 头原样转发，Key 始终只在你的浏览器里。
 *   - 可选：在 Worker 里设置环境变量 RELAY_TOKEN，强制要求 x-relay-token 头，
 *     防止别人扫到你的域名白嫖（但扩展目前不带这个头，开了就要自己改扩展或加一层校验）。
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    const url = new URL(request.url);
    if (!url.pathname.endsWith("/v1/systemone")) {
      return json({ error: "not found", expect: "/v1/systemone" }, 404);
    }

    if (env.RELAY_TOKEN && request.headers.get("x-relay-token") !== env.RELAY_TOKEN) {
      return json({ error: "forbidden" }, 403);
    }

    const auth = request.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return json({ error: "missing bearer token" }, 401);
    }

    let upstream;
    try {
      upstream = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          authorization: auth,
          "content-type": "application/json",
        },
        body: await request.text(),
      });
    } catch (err) {
      return json({ error: "upstream fetch failed", detail: String(err) }, 502);
    }

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS,
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
    });
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
