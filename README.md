# NEW IDEAS

NEW IDEAS 是一个桌面端科研 idea 管理工具，用于记录、分类、推进和归档科研灵感。项目围绕研究路线、文档仓库、实验计划和论文推进状态设计，适合作为轻量本地工作区。

## 功能概览

- 新建、编辑、删除科研 idea
- 四种状态：未开始、已开始、已完成、放弃
- Dashboard 总览、列表视图、Ideas Board 看板
- 状态筛选、标签筛选、实时搜索、排序
- Related Document Repository：支持 URL、GitHub、Overleaf、本地文件夹、本地文件、PDF、数据集等索引
- 本地文件夹/文件选择、打开路径、复制路径
- JSON 导入导出
- 浅色/深色主题
- AI 新建 Idea：自然语言生成结构化草稿
- AI 整理 Idea：对已有 idea 进行结构化整理，用户确认后保存

## 技术栈

- Desktop: Tauri 2
- Frontend: React 18 + TypeScript + Vite
- Styling: Tailwind CSS + 自定义 CSS
- Icons: lucide-react
- Storage MVP: IndexedDB storage adapter
- Desktop plugins: Tauri Dialog、Tauri Shell
- AI: OpenAI-compatible / OpenAI / Anthropic provider adapter via Tauri command

## 安装与运行

```bash
npm install
npm run tauri:dev
```

前端开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

桌面应用打包：

```bash
npm run tauri:build
```

## 数据存储

项目默认不包含任何 idea。`src/sampleData.ts` 保留为空数组，首次启动时如果本地工作区没有数据，会显示空状态：“还没有科研 idea，可创建第一个灵感。”

当前 MVP 使用 IndexedDB 作为统一 storage adapter：

- ideas、related repositories、主题和 LLM settings 通过 `src/storage.ts` 读写
- 旧版本 `localStorage` 数据会在首次启动时自动迁移到 IndexedDB
- 迁移成功后会写入 `localStorageV1Completed` 标记，避免重复迁移
- 用户本地数据不会写入 Git 仓库
- clone 仓库不会包含任何用户本地新增 ideas
- 只有手动导出的 JSON 文件被提交到仓库时，相关数据才会进入公开仓库

后续可将 adapter 替换为 Tauri SQLite 插件或其他桌面端存储方案。

## LLM 配置

AI 功能通过以下路径调用：

```text
React UI -> Tauri command -> Rust 后端 Provider Adapter -> IdeaDraft JSON -> 前端表单
```

在 Settings Page 中配置：

- Provider：`OpenAI-compatible`、`OpenAI`、`Anthropic`
- API Key
- Base URL
- Model

Provider 默认推荐使用 `OpenAI-compatible`。DeepSeek、硅基流动、本地 Ollama/OpenAI-compatible server 和第三方代理都统一走 `OpenAI-compatible`，不要作为单独 Provider。

配置示例：

- DeepSeek：Provider `OpenAI-compatible`，Base URL `https://api.deepseek.com`，Model 可通过“刷新模型列表”选择，或手动填写服务端支持的模型名。
- OpenAI：Provider `OpenAI`，Base URL `https://api.openai.com/v1`。
- Anthropic：Provider `Anthropic`，Base URL `https://api.anthropic.com`，Model 可使用预设 `claude-3-5-sonnet-latest`、`claude-3-5-haiku-latest`、`claude-3-opus-latest`，也可手动填写。

OpenAI-compatible / OpenAI 的模型刷新会请求 `GET {baseUrl}/models`。连接测试会请求 `POST {baseUrl}/chat/completions`。Anthropic 连接测试会请求 `POST {baseUrl}/v1/messages`。

`OPENAI_BASE_URL` 可用于 OpenAI-compatible endpoint、本地模型服务或第三方兼容接口。AI 生成结果只会填入 New / Edit Idea 表单，不会自动保存，必须由用户确认后写入本地工作区。

API Key 不应写入源码或提交到 GitHub。当前 MVP 通过 storage adapter 保存本地配置；后续可将敏感配置替换为 Tauri 官方安全存储或系统 keychain adapter。

`.env.example` 仅提供开发环境示例，不包含真实 key：

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

## Related Document Repository

每个 idea 可以关联多个文档、仓库或本地路径。支持类型包括：

- GitHub / Overleaf / URL
- Local Folder
- Local File
- PDF
- Dataset
- Other

本地文件夹和文件通过 Tauri Dialog 插件选择；打开路径和 URL 通过 Tauri Shell 插件执行。附件索引字段包括 `name`、`type`、`urlOrPath`、`note`、`indexedAt`、`fileSize`、`extension`。

## 目录结构

```text
.
├─ public/
│  └─ assets/
├─ src/
│  ├─ ai.ts
│  ├─ App.tsx
│  ├─ constants.ts
│  ├─ main.tsx
│  ├─ sampleData.ts
│  ├─ storage.ts
│  ├─ styles.css
│  ├─ types.ts
│  └─ utils.ts
├─ src-tauri/
│  ├─ capabilities/
│  ├─ icons/
│  ├─ src/
│  └─ tauri.conf.json
└─ package.json
```

## 验证建议

1. 清空 IndexedDB 和旧 `localStorage` 后启动应用，确认显示空状态。
2. 在旧版本存在 `new-ideas:ideas:v1` 数据时启动应用，确认数据自动迁移。
3. 在 Settings Page 配置 API Key、Base URL、Model 后测试 “AI 新建 Idea”。
4. 在 Idea 编辑弹窗中选择本地文件夹或文件，保存后在详情页测试打开路径和复制路径。

## 后续扩展点

- 将 IndexedDB adapter 替换为 Tauri SQLite 插件。
- 将 API Key adapter 替换为 Tauri 官方安全存储或系统 keychain。
- 增加 Markdown 编辑器与预览。
- 增加附件内容索引、全文搜索和文件变更检测。
- 增加标签管理页、批量标签操作和标签颜色。
- 增加 idea 时间线、实验记录、文献笔记和论文草稿链接。
