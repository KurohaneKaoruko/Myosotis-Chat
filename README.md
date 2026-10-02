# Myosotis

> 一朵永不忘记你的 AI 伙伴。

一款**本地优先**的 AI 聊天应用：界面像日常聊天软件一样自然，开箱即用——只需填入任意一家模型服务商的 API Key，无需部署任何服务器，没有任何技术要求。

## 特性

- 🌸 **像聊天软件，不像工具**：会话列表、气泡消息、语音输入、图片发送、流式输出，移动端/桌面端同一套体验
- 🧠 **真正的记忆系统**（核心）：
  - 人设层 —— 伙伴的性格永不丢失
  - 长期记忆 —— 自动从对话中提取你的喜好、经历、约定，跨对话保持
  - 滚动摘要 —— 长对话自动压缩，上下文永不溢出
  - 向量检索 —— 配置 Embedding 模型后按语义回忆；不配置则自动降级为关键词匹配
  - 记忆花园 —— 每一条记忆都可查看、编辑、置顶、删除，完全透明可控
- 🎭 **多伙伴**：内置多种性格预设，支持自由创建人设（身份、口吻、与你的关系）、专属开场白与模型
- 🔌 **三大协议原生支持**：OpenAI 兼容（DeepSeek / 硅基流动 / Kimi / 智谱 / OpenRouter / Ollama…）、Anthropic、Gemini
- 🗣️ **语音**：默认使用系统自带的朗读与识别（零配置、免费），可选配置云端 TTS/STT 模型
- 🎨 **多种主题**：6 套主题色 × 明暗模式 × 聊天背景
- 🔒 **隐私**：对话、记忆、API Key 全部只存本机（IndexedDB），直连服务商，支持一键备份/恢复

## 技术栈

| 层 | 选择 | 说明 |
|---|---|---|
| 应用壳 | Tauri 2 | 桌面（Win/macOS/Linux）+ 移动（Android/iOS），调用系统 WebView，安装包 MB 级 |
| 前端 | React 19 + TypeScript + Vite | 无重型 UI 库，手写 CSS 变量主题系统 |
| 状态 | Zustand | 轻量全局状态 |
| 存储 | Dexie（IndexedDB） | 全平台统一的本地数据库 |
| 渲染 | marked + DOMPurify | Markdown 渲染与净化 |

## 开发

```bash
pnpm install

# 网页开发模式（浏览器直接访问 http://localhost:5173）
pnpm dev

# 桌面应用开发模式（需要 Rust 工具链）
pnpm tauri dev

# 打包桌面安装包（需要 Rust 工具链）
pnpm tauri build
```

### 移动端

```bash
pnpm tauri android init   # 首次：初始化 Android 工程（需要 Android Studio/SDK）
pnpm tauri android dev
pnpm tauri ios init       # 需要 macOS + Xcode
```

### 图标

`scripts/make-icon.ps1` 生成 `app-icon.png`（五瓣小花），再执行 `pnpm tauri icon app-icon.png` 生成全套平台图标。

## 目录结构

```
├─ src/
│  ├─ components/     # UI 组件（聊天、伙伴、记忆、设置）
│  ├─ lib/
│  │  ├─ api.ts       # 三协议统一模型客户端（流式）
│  │  ├─ memory.ts    # 记忆引擎（抽取/检索/摘要/组装）
│  │  ├─ speech.ts    # 系统朗读与识别
│  │  └─ db.ts        # 本地数据库 + 备份
│  ├─ styles/         # 主题与样式
│  ├─ store.ts        # 全局状态与消息编排
│  └─ types.ts        # 数据模型
├─ src-tauri/         # Tauri 壳（桌面 + 移动）
└─ scripts/           # 图标生成脚本
```

## 版本

从 `0.1.0` 开始迭代。
