import {
  Archive,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  PauseCircle,
  type LucideIcon,
} from "lucide-react";
import type { IdeaStatus, Priority, RepositoryType } from "./types";

export const statusMeta: Record<
  IdeaStatus,
  { label: string; shortLabel: string; description: string; icon: LucideIcon; accent: string; chip: string }
> = {
  not_started: {
    label: "未开始的 ideas",
    shortLabel: "未开始",
    description: "灵感池、backlog、尚未正式推进的科研想法",
    icon: CircleDashed,
    accent: "bg-slate-500",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
  },
  in_progress: {
    label: "已开始的 ideas",
    shortLabel: "已开始",
    description: "调研、实验、建模、写作或验证中的研究路线",
    icon: FlaskConical,
    accent: "bg-cobalt",
    chip: "bg-blue-50 text-blue-700 border-blue-200",
  },
  completed: {
    label: "已完成的 ideas",
    shortLabel: "已完成",
    description: "已有论文、报告、实验验证或阶段性成果",
    icon: CheckCircle2,
    accent: "bg-pine",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  abandoned: {
    label: "放弃的 ideas",
    shortLabel: "放弃",
    description: "暂缓、不可行或优先级降低，保留以便复盘",
    icon: PauseCircle,
    accent: "bg-copper",
    chip: "bg-stone-100 text-stone-700 border-stone-200",
  },
};

export const statusOrder: IdeaStatus[] = [
  "not_started",
  "in_progress",
  "completed",
  "abandoned",
];

export const priorityMeta: Record<Priority, { label: string; weight: number; chip: string }> = {
  low: { label: "Low", weight: 1, chip: "bg-slate-100 text-slate-600 border-slate-200" },
  medium: { label: "Medium", weight: 2, chip: "bg-amber-50 text-amber-700 border-amber-200" },
  high: { label: "High", weight: 3, chip: "bg-rose-50 text-rose-700 border-rose-200" },
};

export const repositoryTypeLabels: Record<RepositoryType, string> = {
  local_folder: "本地文件夹",
  github: "GitHub",
  overleaf: "Overleaf",
  pdf: "PDF",
  dataset: "数据集",
  other: "其他",
};

export const emptyIdeaContent = `## 问题背景

## 创新点

## 研究假设

## 可能的技术路线
`;

export const emptyIdeaPlan = `- [ ] 文献调研
- [ ] 数据收集
- [ ] 模型建立
- [ ] 实验验证
- [ ] 论文写作`;
