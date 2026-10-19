# Myosotis Chat

> 不准忘记我。

一套**多端**的 AI 陪伴聊天系统：服务器核心（Hub）承载记忆、模型调用与聊天软件接入，
桌面端 / 移动端 / 浏览器端都是它的客户端。

```
                    ┌──────────────────────────────────────────┐
   浏览器 (Web) ───▶│                                          │
   桌面 (Tauri) ───▶│            Myosotis Hub                  │
   移动 (Tauri) ───▶│  鉴权 · 会话 · 记忆引擎 · 模型调用      │
                    │  SSE 流式 · OneBot 适配 · Agent 工具桥   │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────┴──────────────────────────┐
                    ▼                   ▼                      ▼
              模型服务商          QQ/聊天软件           claude code / codex …
              (OpenAI/Anthropic  (napcat · OneBot v11)    (命令行 Agent 工具)
               /Gemini 兼容)
```

## 特性

| 能力 | 说明 |
| --- | --- |
| 🧠 **记忆系统** | 人设层 + 工作记忆 + 长期记忆（自动抽取/向量检索/关键词降级）+ 滚动摘要；记忆花园可查看、编辑、置顶、删除 |
| 🪻 **多伙伴** | 多个智能体（不同人设/口吻/模型），支持多人群聊圆桌、剧情模式 |
| 🔐 **服务器鉴权** | scrypt 口令哈希 + 会话 Cookie + 可选 TOTP 两步验证；首个账号自助注册 |
| 💬 **多端一致** | Web / 桌面 / 移动共享同一份数据与记忆；本机模式依然可用（离线优先） |
| 🔌 **聊天软件接入** | OneBot v11 协议适配（napcat / Lagrange / LLOneBot），私聊直回、群聊 @触发、图片走视觉模型 |
| 🛠 **Agent 工具桥** | 本项目自身不是 Agent，但可把 claude code、codex 等 CLI Agent 接进来执行任务 |
| 📡 **多协议模型** | OpenAI 兼容（DeepSeek / Kimi / 智谱 / OpenRouter / Ollama…）、Anthropic、Gemini |
| 🗣 **语音** | 系统朗读与识别（零配置），可配置云端 TTS/STT |
| 🎨 **主题** | 7 套主题色 × 明暗模式 × 聊天背景 |

## 目录结构

```
Myosotis-Chat/
├─ packages/
│  └─ core/              共享内核：类型、记忆引擎、多协议模型客户端、群聊引擎
│                         （平台无关，浏览器与服务器复用同一份逻辑）
├─ apps/
│  ├─ hub/               服务器核心（Fastify + node:sqlite）
│  │  ├─ src/db.ts         数据库 + 存储端口
│  │  ├─ src/auth.ts       scrypt / 会话 / TOTP
│  │  ├─ src/chat-service.ts  聊天编排（记忆检索→摘要→生成→抽取）
│  │  ├─ src/adapter-onebot.ts  OneBot v11 适配器
│  │  ├─ src/agent-bridge.ts    Agent 工具桥（claude/codex…）
│  │  └─ src/index.ts       路由、鉴权中间件、SSE、静态托管
│  ├─ web/               浏览器端（React 19 + Vite），同时被桌面/移动壳复用
│  └─ desktop/           Tauri 2 壳（桌面 + 移动）
└─ data/                 服务器数据（SQLite，默认 gitignore）
```

## 快速开始

### 1. 开发模式（三个终端）

```bash
pnpm install

# 终端 A：服务器核心
pnpm dev:hub          # http://127.0.0.1:8791

# 终端 B：前端（Vite，已代理 /api 到 Hub）
pnpm dev              # http://localhost:5173
```

浏览器打开 <http://localhost:5173>，首次访问会自动创建服务器账号。

> 前端默认连接同源的 Hub；若前端与 Hub 不在同一域名，可在「设置 → 服务器」里填写 Hub 地址。

### 2. 生产部署（服务器）

```bash
pnpm install
pnpm --filter @myosotis/web build        # 产出 apps/web/dist
pnpm --filter @myosotis/hub start        # 启动 Hub，默认 :8790
```

Hub 会同时托管前端静态资源与 API，浏览器直接访问 `http://<服务器>:8790` 即可。
建议用 Nginx / Caddy 反向代理并启用 HTTPS（Cookie 会自动带上 `Secure`）：

```nginx
server {
  server_name myosotis.example.com;
  location / {
    proxy_pass http://127.0.0.1:8790;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # SSE 需要
    proxy_read_timeout 3600s;
  }
}
```

### 3. 桌面 / 移动端

```bash
# 桌面
pnpm --filter @myosotis/desktop tauri dev
pnpm --filter @myosotis/desktop tauri build

# 移动端（需要 Android Studio / Xcode）
pnpm --filter @myosotis/desktop tauri android init
pnpm --filter @myosotis/desktop tauri android dev
```

壳内打开「设置 → 服务器」填入 Hub 地址，即进入服务器模式（与网页端共享数据）；
不填则使用本机模式（IndexedDB 本地存储，完全离线）。

## 服务器环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8790` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `MYO_DATA_DIR` | `<repo>/data` | SQLite 数据目录 |
| `MYO_WEB_DIST` | `apps/web/dist` | 前端静态资源目录 |
| `TRUST_PROXY` | `0` | 置于反向代理后时设为 `1` |
| `ONEBOT_ENABLED` | `0` | 是否启用 OneBot 适配器 |
| `ONEBOT_MODE` | `reverse` | `reverse`（napcat 主动连我们）/ `forward`（我们连 napcat） |
| `ONEBOT_LISTEN_PORT` | `8081` | reverse 模式监听端口 |
| `ONEBOT_ACCESS_TOKEN` | — | reverse 模式校验用 token（napcat 用 `?access-token=` 传） |
| `ONEBOT_URL` | — | forward 模式的 ws 地址，如 `ws://127.0.0.1:3001` |
| `ONEBOT_TOKEN` | — | forward 模式的鉴权 token |
| `MYO_TOOLS_CWD` | `<data>` | Agent 工具的工作目录 |

## 接入聊天软件（napcat / OneBot v11）

1. 在 napcat 中启用 OneBot v11 反向 WebSocket，地址填 `ws://<hub>:8081`
   （若设置了 `ONEBOT_ACCESS_TOKEN`，地址写成 `ws://<hub>:8081?access-token=<token>`）。
2. 在 Web 端「设置 → 连接」里为聊天对象建立绑定：
   - 私聊：`user:20002`
   - 群聊：`group:30003`
   - 绑定后指定由哪位伙伴回复。
3. 群里 `@机器人` 即可对话；未绑定会收到提示。

也可在「设置 → 连接」里直接改适配器运行参数（模式、地址、端口、token），无需重启。

## 接入 Agent 工具（claude code / codex …）

本项目**不实现** Agent 逻辑，只做桥接：在服务器上 spawn 对应 CLI，把输出流回对话。

- 「设置 → 连接」可看到服务器上安装了哪些工具（`claude` / `codex` / `gemini` / `qwen` / `aider`）。
- 聊天框输入 `/claude 重构这个函数` 即可调用；工具输出会作为一条助手消息留在对话里。
- 工具自身的登录态由 CLI 自己管理（`claude login` / `codex login`），Hub 不接触凭据。

## 安全说明

- 口令使用 scrypt 加盐哈希；会话为 HttpOnly Cookie（SameSite=Lax，可选 Secure）。
- 记忆、会话、模型配置按用户隔离，跨账号不可见。
- Agent 工具以服务器用户身份运行，**请仅在受信任的服务器上启用**。
- 建议始终通过 HTTPS 暴露 Hub。

## 许可

MIT
