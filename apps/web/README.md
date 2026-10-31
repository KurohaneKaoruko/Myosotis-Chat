# Myosotis Web

> 不准忘记我。

Myosotis 的**前端应用**（React 19 + Vite + TypeScript），同一份代码跑在三个壳里：
浏览器直接访问、Tauri 桌面端、Tauri 移动端。见根目录 README 了解整体架构。

## 两种工作模式

| 模式 | 存储 | 适用 |
| --- | --- | --- |
| **服务器模式** | Myosotis Hub（REST + SSE），多端实时同步 | 页面由 Hub 托管时自动启用；或在「设置 → 服务器」填 Hub 地址 |
| **本机模式** | IndexedDB（Dexie），完全离线 | 未配置服务器时的默认值；数据只在本机 |

模式可随时切换（`localStorage` 里的用户选择优先于自动探测）。

## 特性

- 💬 **聊天体验**：会话列表、气泡消息、流式输出、图片发送、语音输入/朗读、草稿自动保存、全局搜索
- 🧠 **记忆花园**：每条长期记忆可查看、编辑、置顶、删除（服务器模式下多端同步）
- 🎭 **多伙伴**：不同人设/口吻/模型的智能体；群聊圆桌、剧情模式
- 🔌 **三协议模型**：OpenAI 兼容 / Anthropic / Gemini，支持 Key 池轮换与连通性探测
- 🎨 **7 套主题色 × 明暗模式 × 聊天背景**，手写 CSS 变量主题系统
- 🔒 **备份**：本机模式支持 JSON 导出/导入 + WebDAV 云备份，可选 AES-GCM-256 口令加密

## 开发

```bash
# 仓库根目录
pnpm install

# 终端 A：Hub 服务器（http://127.0.0.1:8791）
pnpm dev:hub

# 终端 B：前端 dev server（http://localhost:5173，已代理 /api 到 Hub）
pnpm dev
```

首次打开页面会引导创建服务器账号。只跑 `pnpm dev`（无 Hub）则以本机模式运行。

## 目录结构

```
apps/web/
├─ App.tsx            # 顶层布局与视图切换
├─ main.tsx           # 入口
├─ store.ts           # Zustand 全局状态 + 本机/服务器两套消息编排
├─ components/        # UI 组件（聊天、记忆花园、设置、伙伴编辑器…）
├─ lib/
│  ├─ db.ts           # 存储后端切换（local ↔ remote，同一张表接口）
│  ├─ db-local.ts     # Dexie（IndexedDB）实现
│  ├─ db-remote.ts    # Hub REST 实现
│  ├─ live.ts         # SSE 实时同步（多端消息/设置/记忆推送）
│  ├─ speech.ts       # 系统 TTS/STT + 云端模型
│  ├─ webdav.ts       # WebDAV 备份客户端（零依赖）
│  ├─ crypto.ts       # 备份加密（PBKDF2 + AES-GCM）
│  └─ uploads.ts      # 图片上传（内容寻址存储）
├─ i18n/              # zh-CN / en 文案
└─ styles/            # 主题变量与样式
```

模型调用、记忆引擎、群聊引擎在 `packages/core`（前端与 Hub 共用同一份逻辑）。
