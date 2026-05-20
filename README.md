# NEW IDEAS

NEW IDEAS 是一个桌面端科研 idea 管理工具，用于记录、分类、推进和归档科研灵感。它不是普通待办软件，而是围绕研究路线、文档仓库、实验计划和论文推进状态设计的轻量工作台。

## 技术栈

- Desktop: Tauri 2
- Frontend: React 18 + TypeScript + Vite
- Styling: Tailwind CSS + 自定义 CSS 变量
- Icons: lucide-react
- Local persistence: localStorage MVP
- AI: OpenAI Responses API via Tauri command
- Future-ready: 存储层已独立封装，后续可替换为 SQLite、IndexedDB 或云同步

## 项目结构

```text
.
├─ public/
│  └─ assets/                 # logo、空状态插图、后续 image2/frontdesign 资产入口
├─ src/
│  ├─ App.tsx                 # 主应用、页面与核心组件
│  ├─ constants.ts            # 状态、优先级、仓库类型元数据
│  ├─ main.tsx                # React 入口
│  ├─ ai.ts                   # 前端 AI command 调用与 IdeaDraft 转换
│  ├─ sampleData.ts           # 空默认数据，避免 clone 后出现示例 idea
│  ├─ storage.ts              # 本地持久化、导入导出
│  ├─ styles.css              # 桌面端 UI 样式
│  ├─ types.ts                # Idea 数据模型
│  └─ utils.ts                # 搜索、排序、摘要、日期等工具函数
├─ src-tauri/
│  ├─ capabilities/           # Tauri 权限
│  ├─ icons/                  # 桌面应用图标
│  ├─ src/                    # Rust 入口
│  └─ tauri.conf.json         # Tauri 配置
└─ package.json
```

## 已实现 MVP

- 新建、编辑、永久删除 idea
- 一键移入“放弃”
- 四种状态：未开始、已开始、已完成、放弃
- 状态筛选、标签筛选、实时搜索
- 按最近更新、优先级、创建时间、标题排序
- Dashboard 总览、最近更新、状态数量统计
- Ideas Board 看板，支持拖拽改变状态
- Idea Detail 详情页，展示 Content、Plan、Related Document Repository
- 相关文档仓库增删改，URL 可点击打开，本地路径可复制
- 本地持久化保存
- 数据 JSON 导入导出
- 浅色/深色主题切换
- Tauri 桌面壳和基础图标
- AI 新建 Idea：自然语言生成结构化草稿，用户确认后保存
- AI 整理 Idea：在编辑弹窗中整理当前 idea，先填入表单，不自动保存

## 默认数据与本地存储

本项目默认不包含任何 idea。`src/sampleData.ts` 保留为空数组，首次启动时如果 `localStorage` 没有数据，会显示空状态：“还没有科研 idea，创建你的第一个灵感。”

用户本地新增、编辑或导入的 ideas 会保存到浏览器 `localStorage`，不会写入 Git 仓库。别人 clone 仓库后不会看到你的本地 ideas。只有当用户手动导出 JSON，并把该 JSON 文件提交到仓库时，其他人才可能看到这些数据。

## AI 功能

NEW IDEAS 支持通过自然语言生成结构化科研 idea，也支持在编辑弹窗中对已有 idea 进行 AI 整理。AI 返回 `IdeaDraft` 后只会填入 New / Edit Idea 表单，必须由用户确认点击保存，才会进入 `localStorage`。

AI 调用路径：

```text
React UI -> Tauri command -> Rust 后端 -> OpenAI Responses API -> IdeaDraft JSON -> 前端表单
```

API Key 不会出现在 React 前端代码中。Rust 后端从本机环境变量读取：

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4.1-mini
```

可复制 `.env.example` 为 `.env` 后填写本机 Key；`.env` 已在 `.gitignore` 中，禁止提交到 GitHub。后端也预留了 `OPENAI_BASE_URL`，后续可以切换 OpenAI-compatible endpoint，例如本地模型或第三方兼容服务。

如果没有配置 API Key，前端会显示：

```text
未配置 OpenAI API Key，请先在环境变量或设置页中配置。
```

## 运行

安装依赖：

```bash
npm install
```

启动 Web 开发环境：

```bash
npm run dev
```

启动 Tauri 桌面开发环境：

```bash
npm run tauri:dev
```

生产构建前端：

```bash
npm run build
```

打包桌面应用：

```bash
npm run tauri:build
```

## AI 新建 Idea 测试

1. 配置 `OPENAI_API_KEY`，可选配置 `OPENAI_MODEL`。
2. 运行 `npm install`。
3. 运行 `npm run tauri:dev`。
4. 点击 Header 或 Dashboard 的“AI 新建 Idea”。
5. 输入自然语言描述，例如：

```text
我想研究转轮除湿系统中传感器噪声对模型辨识的影响，可能用 UKF 或粒子滤波做数据同化。
```

6. 点击“生成结构化 Idea”。
7. 预览满意后点击“插入到新建 Idea 表单”，继续手动编辑并保存。

## 默认数据确认

- `src/sampleData.ts` 中 `sampleIdeas` 是空数组。
- `src/storage.ts` 在 `localStorage` 没有数据或解析失败时返回空数组。
- 清空浏览器/Tauri WebView 的 localStorage 后重新启动，首页应显示空状态，不会出现仓库写死的默认 idea。

## 后续扩展点

- 将 `src/storage.ts` 从 localStorage 替换为 Tauri SQLite 插件或 IndexedDB。
- 接入 Markdown 编辑器与预览，例如 CodeMirror / Milkdown / TipTap。
- 为 Related Document Repository 增加本地文件夹选择、打开文件夹、附件索引。
- 在 Settings Page 中增加本机 API Key 保存与模型切换 UI，保存到本机安全存储，不提交仓库。
- 将 `OPENAI_BASE_URL` 暴露为设置项，用于本地模型或第三方 OpenAI-compatible endpoint。
- 增加标签管理页、批量标签操作和标签颜色。
- 增加 idea 时间线、实验记录、文献笔记和论文草稿链接。
- 增加云同步层，可按 `Idea` 类型序列化到 WebDAV、Git repo 或自建 API。
- 替换 `public/assets` 与 `src-tauri/icons` 中的占位资产为正式 image2 生成资产。

## 视觉资产

本项目已生成并接入以下资产：

- `public/assets/logo.png`
- `public/assets/app-icon.png`
- `public/assets/empty-state.png`
- `src-tauri/icons/icon.png`
- `src-tauri/icons/icon.ico`
