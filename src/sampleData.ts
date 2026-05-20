import type { Idea } from "./types";

const now = new Date();
const isoDaysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();

export const sampleIdeas: Idea[] = [
  {
    id: "idea_seed_paper",
    title: "面向科研 idea 的轻量知识库工作流",
    content:
      "把科研灵感、文献记录、代码仓库、Overleaf 草稿和实验日志统一到一个轻量结构中，减少早期研究路线丢失。",
    plan: "- [x] 产品需求整理\n- [x] 交互原型\n- [x] MVP 实现\n- [ ] 桌面端打包\n- [ ] Markdown 编辑器\n- [ ] SQLite 本地存储",
    repositories: [
      {
        id: "repo_seed_2",
        name: "Overleaf 草稿",
        type: "overleaf",
        urlOrPath: "https://www.overleaf.com/project/example",
      },
    ],
    status: "in_progress",
    tags: ["论文想法", "知识库", "工具"],
    priority: "high",
    createdAt: isoDaysAgo(30),
    updatedAt: isoDaysAgo(0),
    progress: 68,
  },
];
