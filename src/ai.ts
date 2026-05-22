import { invoke } from "@tauri-apps/api/core";
import type { DailyTodo, Idea, IdeaDraft, LlmSettings, RelatedRepository, TestConnectionResult, TodoDraft } from "./types";
import { calculateTodoProgress, createId, normalizeTags, normalizeTodoDrafts } from "./utils";

const missingApiKeyMessage = "未配置 API Key，请先在 Settings Page 配置。";

export async function generateIdeaWithAI(input: string, settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  return sanitizeIdeaDraft(await invoke<IdeaDraft>("generate_idea_with_ai", { input, config }));
}

export async function organizeIdeaWithAI(input: IdeaDraft, settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  return sanitizeIdeaDraft(await invoke<IdeaDraft>("organize_idea_with_ai", { input, config }));
}

export async function modifyIdeaWithAI(input: IdeaDraft, instruction: string, settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  return sanitizeIdeaDraft(await invoke<IdeaDraft>("modify_idea_with_ai", { input: { idea: input, instruction }, config }));
}

export async function fetchLlmModels(settings: LlmSettings) {
  const config = normalizeLlmSettings(settings, { allowMissingModel: true });
  return invoke<string[]>("fetch_llm_models", { config });
}

export async function testLlmConnection(settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  return invoke<TestConnectionResult>("test_llm_connection", { config });
}

export async function generateProjectTodosWithAI(idea: Pick<Idea, "title" | "content" | "plan" | "notes">, settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  const result = await invoke<{ todos: TodoDraft[] }>("generate_project_todos_with_ai", { input: idea, config });
  return normalizeDraftTodos(result.todos);
}

export async function generateDailyTodosWithAI(input: string, date: string, settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  const result = await invoke<{ todos: TodoDraft[] }>("generate_daily_todos_with_ai", { input, date, config });
  return normalizeDraftTodos(result.todos);
}

export function draftTodosToDailyTodos(drafts: TodoDraft[], date: string, startOrder = 0): DailyTodo[] {
  const now = new Date().toISOString();
  return normalizeDraftTodos(drafts).map((todo, index) => {
    const status = todo.status ?? "todo";
    return {
      id: createId("daily"),
      title: todo.title,
      description: todo.description || undefined,
      status,
      priority: todo.priority ?? "medium",
      date,
      createdAt: now,
      updatedAt: now,
      completedAt: status === "done" ? now : undefined,
    tags: normalizeTags(todo.tags ?? []),
    order: startOrder + index,
    linkedProjectTodos: [],
    };
  });
}

export function ideaToDraft(idea: Idea): IdeaDraft {
  return {
    title: idea.title,
    content: idea.content,
    plan: idea.plan,
    todos: idea.todos.map(
      ({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, completedAt: _completedAt, order: _order, link: _link, source: _source, ...todo }) =>
        todo,
    ),
    repositories: idea.repositories.map(({ id: _id, ...repo }) => repo),
    status: idea.status,
    tags: idea.tags,
    priority: idea.priority,
    targetDate: idea.targetDate,
    progress: idea.progress ?? 0,
    notes: idea.notes ?? "",
  };
}

export function draftToIdea(draft: IdeaDraft, baseIdea?: Idea): Idea {
  const now = new Date().toISOString();
  const todos = normalizeTodoDrafts(draft.todos, baseIdea?.todos);
  return {
    id: baseIdea?.id ?? createId("idea"),
    title: draft.title.trim(),
    content: draft.content.trim(),
    plan: draft.plan.trim(),
    todos,
    repositories: draft.repositories.map((repo, index): RelatedRepository => ({
      id: baseIdea?.repositories[index]?.id ?? createId("repo"),
      name: repo.name.trim(),
      type: repo.type,
      urlOrPath: repo.urlOrPath.trim(),
      note: repo.note?.trim() ?? "",
      indexedAt: repo.indexedAt,
      fileSize: repo.fileSize,
      extension: repo.extension,
    })),
    status: draft.status,
    tags: normalizeTags(draft.tags),
    priority: draft.priority,
    targetDate: draft.targetDate || undefined,
    progress: calculateTodoProgress(todos),
    notes: draft.notes?.trim() || undefined,
    createdAt: baseIdea?.createdAt ?? now,
    updatedAt: baseIdea?.updatedAt ?? now,
    order: baseIdea?.order ?? 0,
  };
}

function sanitizeIdeaDraft(draft: IdeaDraft): IdeaDraft {
  return {
    title: draft.title?.trim() || "未命名科研 idea",
    content: draft.content?.trim() || "",
    plan: draft.plan?.trim() || "",
    todos: normalizeDraftTodos(Array.isArray(draft.todos) ? draft.todos : []),
    repositories: Array.isArray(draft.repositories) ? draft.repositories : [],
    status: draft.status || "not_started",
    tags: normalizeTags(Array.isArray(draft.tags) ? draft.tags : []),
    priority: draft.priority || "medium",
    targetDate: draft.targetDate || undefined,
    progress: Math.min(100, Math.max(0, Number(draft.progress ?? 0))),
    notes: draft.notes?.trim() || "",
  };
}

function normalizeDraftTodos(todos: IdeaDraft["todos"]): IdeaDraft["todos"] {
  return todos
    .filter((todo) => todo?.title?.trim())
    .map((todo) => ({
      title: todo.title.trim(),
      description: todo.description?.trim() || "",
      status: todo.status === "in_progress" || todo.status === "done" || todo.status === "cancelled" ? todo.status : "todo",
      priority: todo.priority === "low" || todo.priority === "high" ? todo.priority : "medium",
      dueDate: todo.dueDate || undefined,
      tags: normalizeTags(todo.tags ?? []),
    }));
}

function normalizeLlmSettings(settings: LlmSettings, options?: { allowMissingModel?: boolean }): LlmSettings {
  const provider = settings.provider || "openai-compatible";
  if (!provider) throw new Error("请选择 Provider。");
  const baseUrl = settings.baseUrl.trim();
  if (!baseUrl) throw new Error("请填写 Base URL。");
  const apiKey = settings.apiKey.trim();
  if (!apiKey) throw new Error(missingApiKeyMessage);
  const model = settings.model.trim();
  if (!model && !options?.allowMissingModel) throw new Error("请填写或选择 Model。");
  return {
    provider,
    baseUrl,
    apiKey,
    model,
  };
}
