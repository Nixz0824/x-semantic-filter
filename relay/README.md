# Jev 中转 Worker（解决 451）

当 `api.typesafe.ai` 对你的出口 IP 返回 `451 Typesafe is not available in your region` 时，用这个 Worker 在境外转发一次。

## 部署

```bash
npm i -g wrangler
wrangler login
wrangler deploy worker.js --name jev-relay
```

部署完会得到一个地址，形如：

```
https://jev-relay.your-subdomain.workers.dev
```

## 接进扩展

1. 打开扩展设置 → 判断引擎选 **Jev**
2. 「接口地址」填上面那个地址（不要带 `/v1/systemone`，扩展会自己拼）
3. 点「运行判断」验证

第一次请求时 Chrome 会弹权限确认，同意即可（扩展用的是 `optional_host_permissions`，按域名单独授权）。

## 注意

- Key 不经过 Worker 存储，扩展发来的 `Authorization` 头原样转发。
- 免费套餐每天 10 万次请求，够用；单次请求体很小。
- 如果担心别人扫到域名白嫖，可以：

  ```bash
  wrangler secret put RELAY_TOKEN
  ```

  设了之后 Worker 会校验 `x-relay-token` 头——扩展目前不带这个头，所以要么别设，要么在 `background.js` 里给请求加一行 header（搜 `Authorization` 那里）。

## 不想折腾 Cloudflare

两个替代：

1. **浏览器整体走代理**（Clash TUN / 系统代理），让 `api.typesafe.ai` 走境外出口。PAC 模式下记得把这个域名也加进去。
2. **换 OpenAI 兼容后端**（DeepSeek / 硅基流动 / 百炼），国内直连，不需要中转。
