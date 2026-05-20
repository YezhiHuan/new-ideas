# NEW IDEAS

NEW IDEAS 是一个桌面端科研 idea 管理工具，用于记录、分类、推进和归档科研灵感。它不是普通待办软件，而是围绕研究路线、文档仓库、实验计划和论文推进状态设计的轻量工作台。

## 技术栈

- Desktop: Tauri 2
- Frontend: React 18 + TypeScript + Vite
- Styling: Tailwind CSS + 自定义 CSS 变量
- Icons: lucide-react
- Local persistence: localStorage MVP
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
│  ├─ sampleData.ts           # MVP 示例数据
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

## 后续扩展点

- 将 `src/storage.ts` 从 localStorage 替换为 Tauri SQLite 插件或 IndexedDB。
- 接入 Markdown 编辑器与预览，例如 CodeMirror / Milkdown / TipTap。
- 为 Related Document Repository 增加本地文件夹选择、打开文件夹、附件索引。
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
