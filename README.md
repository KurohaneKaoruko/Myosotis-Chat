# Myosotis Chat

> 不准忘记我。

一套**多端**的 AI 陪伴聊天系统：服务器核心（Hub）承载记忆、模型调用与聊天软件接入，
桌面端 / 移动端 / 浏览器端都是它的客户端。

```
                    ┌──────────────────────────────────────────┐
   浏览器 (Web) ───▶│                                          │
   桌面 (Tauri) ───▶│            Myosotis Hub                  │
   移动 (Tauri) ───▶│  鉴权 · 会话 · 记忆引擎 · 模型调用      │
                    │  SSE 流式 · OneBot 适配 · 多端实时同步    │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────┴──────────────────────────┐
                    ▼                   ▼
              模型服务商          QQ/聊天软件
              (OpenAI/Anthropic  (napcat · OneBot v11)
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
│  │  ├─ src/events.ts      实时事件总线（多端同步）
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

## 接入聊天软件（napcat / OneBot v11）

1. 在 napcat 中启用 OneBot v11 反向 WebSocket，地址填 `ws://<hub>:8081`
   （若设置了 `ONEBOT_ACCESS_TOKEN`，地址写成 `ws://<hub>:8081?access-token=<token>`）。
2. 在 Web 端「设置 → 连接」里为聊天对象建立绑定：
   - 私聊：`user:20002`
   - 群聊：`group:30003`
   - 绑定后指定由哪位伙伴回复。
3. 群里 `@机器人` 即可对话；未绑定会收到提示。

也可在「设置 → 连接」里直接改适配器运行参数（模式、地址、端口、token），无需重启。

## 安全说明

- 口令使用 scrypt 加盐哈希；会话为 HttpOnly Cookie（SameSite=Lax，可选 Secure）。
- 记忆、会话、模型配置按用户隔离，跨账号不可见。
- 建议始终通过 HTTPS 暴露 Hub。

## 许可

本项目采用 **GNU GPL v3.0 或更高版本**（SPDX: `GPL-3.0-or-later`）许可。

```
Myosotis Chat — 勿忘我
Copyright (C) 2026  Myosotis Chat contributors

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```

完整条款见 [LICENSE](./LICENSE)。

> GPL 是 copyleft 许可：分发本项目或其衍生作品时，必须以相同许可发布并提供对应源码。

