import { priorityMeta, statusOrder } from "./constants";
import type { Idea, IdeaStatus, Priority, SortMode } from "./types";

export function createId(prefix = "id") {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function formatDate(value?: string) {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateOnly(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function summarizeMarkdown(markdown: string, length = 120) {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > length ? `${plain.slice(0, length)}...` : plain || "还没有记录详细内容。";
}

export function normalizeTags(input: string | string[]) {
  const source = Array.isArray(input) ? input.join(",") : input;
  return Array.from(
    new Set(
      source
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

export function nextStatus(status: IdeaStatus): IdeaStatus {
  const index = statusOrder.indexOf(status);
  return statusOrder[(index + 1) % statusOrder.length];
}

export function sortIdeas(ideas: Idea[], mode: SortMode) {
  return [...ideas].sort((a, b) => {
    if (mode === "priority_desc") {
      const priorityDelta = priorityMeta[b.priority].weight - priorityMeta[a.priority].weight;
      if (priorityDelta !== 0) return priorityDelta;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    if (mode === "created_desc") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (mode === "title_asc") return a.title.localeCompare(b.title, "zh-CN");
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function matchesIdea(idea: Idea, query: string, tag: string, status: IdeaStatus | "all") {
  const normalizedQuery = query.trim().toLowerCase();
  const statusMatch = status === "all" || idea.status === status;
  const tagMatch = tag === "all" || idea.tags.includes(tag);
  const queryMatch =
    !normalizedQuery ||
    [idea.title, idea.content, idea.plan, idea.notes ?? "", idea.tags.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  return statusMatch && tagMatch && queryMatch;
}

export function priorityToProgress(priority: Priority) {
  return priority === "high" ? 72 : priority === "medium" ? 44 : 18;
}
