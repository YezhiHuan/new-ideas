import { invoke } from "@tauri-apps/api/core";
import type { Idea, IdeaDraft, LlmSettings, RelatedRepository, TestConnectionResult } from "./types";
import { createId, normalizeTags } from "./utils";

const missingApiKeyMessage = "未配置 API Key，请先在 Settings Page 配置。";

export async function generateIdeaWithAI(input: string, settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  return sanitizeIdeaDraft(await invoke<IdeaDraft>("generate_idea_with_ai", { input, config }));
}

export async function organizeIdeaWithAI(input: IdeaDraft, settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  return sanitizeIdeaDraft(await invoke<IdeaDraft>("organize_idea_with_ai", { input, config }));
}

export async function fetchLlmModels(settings: LlmSettings) {
  const config = normalizeLlmSettings(settings, { allowMissingModel: true });
  return invoke<string[]>("fetch_llm_models", { config });
}

export async function testLlmConnection(settings: LlmSettings) {
  const config = normalizeLlmSettings(settings);
  return invoke<TestConnectionResult>("test_llm_connection", { config });
}

export function ideaToDraft(idea: Idea): IdeaDraft {
  return {
    title: idea.title,
    content: idea.content,
    plan: idea.plan,
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
  return {
    id: baseIdea?.id ?? createId("idea"),
    title: draft.title.trim(),
    content: draft.content.trim(),
    plan: draft.plan.trim(),
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
    progress: Math.min(100, Math.max(0, Number(draft.progress ?? 0))),
    notes: draft.notes?.trim() || undefined,
    createdAt: baseIdea?.createdAt ?? now,
    updatedAt: baseIdea?.updatedAt ?? now,
  };
}

function sanitizeIdeaDraft(draft: IdeaDraft): IdeaDraft {
  return {
    title: draft.title?.trim() || "未命名科研 idea",
    content: draft.content?.trim() || "",
    plan: draft.plan?.trim() || "",
    repositories: Array.isArray(draft.repositories) ? draft.repositories : [],
    status: draft.status || "not_started",
    tags: normalizeTags(Array.isArray(draft.tags) ? draft.tags : []),
    priority: draft.priority || "medium",
    targetDate: draft.targetDate || undefined,
    progress: Math.min(100, Math.max(0, Number(draft.progress ?? 0))),
    notes: draft.notes?.trim() || "",
  };
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
