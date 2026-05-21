import { priorityMeta, statusOrder } from "./constants";
import type { DailyTodo, Idea, IdeaStatus, Priority, SortMode, TodoDraft, TodoItem, TodoStatus } from "./types";

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
    if (mode === "updated_desc" && Number.isFinite(a.order) && Number.isFinite(b.order) && a.status === b.status) {
      const orderDelta = (a.order ?? 0) - (b.order ?? 0);
      if (orderDelta !== 0) return orderDelta;
    }
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

export function todayDateKey() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function normalizeTodoStatus(status?: string): TodoStatus {
  if (status === "in_progress" || status === "done" || status === "cancelled") return status;
  return "todo";
}

export function normalizePriority(priority?: string): Priority {
  if (priority === "low" || priority === "high") return priority;
  return "medium";
}

export function normalizeTodoDrafts(todos: TodoDraft[] | undefined, existingTodos: TodoItem[] = []): TodoItem[] {
  const now = new Date().toISOString();
  return (Array.isArray(todos) ? todos : [])
    .filter((todo) => todo?.title?.trim())
    .map((todo, index) => {
      const existing = existingTodos[index];
      const status = normalizeTodoStatus(todo.status);
      const completedAt = status === "done" ? existing?.completedAt ?? now : undefined;
      return {
        id: existing?.id ?? createId("todo"),
        title: todo.title.trim(),
        description: todo.description?.trim() || undefined,
        status,
        priority: normalizePriority(todo.priority),
        tags: normalizeTags(Array.isArray(todo.tags) ? todo.tags : []),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        dueDate: todo.dueDate || undefined,
        completedAt,
        order: existing?.order ?? index,
      };
    });
}

export function normalizeIdeaTodos(todos: TodoItem[] | undefined): TodoItem[] {
  const now = new Date().toISOString();
  return (Array.isArray(todos) ? todos : [])
    .filter((todo) => todo?.title?.trim())
    .map((todo, index) => {
      const status = normalizeTodoStatus(todo.status);
      return {
        ...todo,
        id: todo.id || createId("todo"),
        title: todo.title.trim(),
        description: todo.description?.trim() || undefined,
        status,
        priority: normalizePriority(todo.priority),
        tags: normalizeTags(Array.isArray(todo.tags) ? todo.tags : []),
        createdAt: todo.createdAt || now,
        updatedAt: todo.updatedAt || now,
        dueDate: todo.dueDate || undefined,
        completedAt: status === "done" ? todo.completedAt || now : undefined,
        order: Number.isFinite(todo.order) ? todo.order : index,
        link:
          todo.link?.type === "daily_todo" && todo.link.dailyTodoId
            ? {
                type: "daily_todo" as const,
                dailyTodoId: todo.link.dailyTodoId,
                dailyTodoDate: todo.link.dailyTodoDate || todo.source?.date || now.slice(0, 10),
              }
            : undefined,
        source: todo.source,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map((todo, index) => ({ ...todo, order: index }));
}

export function calculateTodoProgress(todos: TodoItem[] | undefined) {
  const activeTodos = (todos ?? []).filter((todo) => todo.status !== "cancelled");
  if (activeTodos.length === 0) return 0;
  const done = activeTodos.filter((todo) => todo.status === "done").length;
  return Math.round((done / activeTodos.length) * 100);
}

export function todoCompletionSummary(todos: TodoItem[] | undefined) {
  const activeTodos = (todos ?? []).filter((todo) => todo.status !== "cancelled");
  const done = activeTodos.filter((todo) => todo.status === "done").length;
  return { done, total: activeTodos.length, cancelled: (todos ?? []).filter((todo) => todo.status === "cancelled").length };
}

export function withCalculatedIdeaProgress(idea: Idea): Idea {
  const todos = normalizeIdeaTodos(idea.todos);
  return {
    ...idea,
    todos,
    progress: calculateTodoProgress(todos),
  };
}

export function sortDailyTodos(todos: DailyTodo[]) {
  return [...todos].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.order - b.order || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function matchesDailyTodo(todo: DailyTodo, query: string, tag: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const tagMatch = tag === "all" || todo.tags.includes(tag);
  const queryMatch =
    !normalizedQuery ||
    [todo.title, todo.description ?? "", todo.tags.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  return tagMatch && queryMatch;
}

export function projectTodoFromDailyTodo(todo: DailyTodo, order: number, linked = false): TodoItem {
  const now = new Date().toISOString();
  return {
    id: createId("todo"),
    title: todo.title,
    description: todo.description,
    status: normalizeTodoStatus(todo.status),
    priority: normalizePriority(todo.priority),
    tags: normalizeTags(todo.tags),
    createdAt: now,
    updatedAt: now,
    completedAt: todo.status === "done" ? todo.completedAt || now : undefined,
    order,
    link: linked
      ? {
          type: "daily_todo",
          dailyTodoId: todo.id,
          dailyTodoDate: todo.date,
        }
      : undefined,
  };
}
