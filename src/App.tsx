import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  Calendar,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCopy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  FolderOpen,
  Home,
  Languages,
  Layers3,
  Link2,
  ListTodo,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { ChangeEvent, type CSSProperties, FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyIdeaContent,
  emptyIdeaPlan,
  priorityMeta,
  repositoryTypeLabels,
  statusMeta,
  statusOrder,
} from "./constants";
import {
  draftToIdea,
  draftTodosToDailyTodos,
  fetchLlmModels,
  generateDailyTodosWithAI,
  generateIdeaWithAI,
  generateProjectTodosWithAI,
  ideaToDraft,
  modifyIdeaWithAI,
  testLlmConnection,
} from "./ai";
import { createTranslator, I18nProvider, useI18n } from "./i18n";
import { defaultSettings, exportData, importDataFromFile, loadAppData, saveDailyTodos, saveIdeas, saveSettings } from "./storage";
import type {
  AppMode,
  AppSettings,
  DailyTodo,
  DailyTodoStatus,
  Idea,
  IdeaDraft,
  IdeaStatus,
  LinkedProjectTodo,
  LlmSettings,
  Priority,
  RelatedRepository,
  RepositoryType,
  SortMode,
  TestConnectionResult,
  ThemeMode,
  TodoItem,
  TodoDraft,
  TodoStatus,
  ViewMode,
} from "./types";
import {
  calculateTodoProgress,
  createId,
  formatDate,
  formatDateOnly,
  matchesDailyTodo,
  matchesIdea,
  normalizePriority,
  nextStatus,
  normalizeTags,
  normalizeTodoStatus,
  projectTodoFromDailyTodo,
  sortDailyTodos,
  sortIdeas,
  summarizeMarkdown,
  todayDateKey,
  todoCompletionSummary,
  withCalculatedIdeaProgress,
} from "./utils";

type StatusFilter = IdeaStatus | "all";

const todoStatusMeta: Record<TodoStatus, { label: string; shortLabel: string; className: string }> = {
  todo: { label: "To Do", shortLabel: "待办", className: "todo" },
  in_progress: { label: "In Progress", shortLabel: "进行中", className: "in-progress" },
  done: { label: "Done", shortLabel: "完成", className: "done" },
  cancelled: { label: "Cancelled", shortLabel: "取消", className: "cancelled" },
};

const todoStatusOrder: TodoStatus[] = ["todo", "in_progress", "done", "cancelled"];

const ideaColumnId = (status: IdeaStatus) => `idea-column:${status}`;
const todoColumnId = (scope: "project" | "daily", status: TodoStatus) => `${scope}-todo-column:${status}`;

function ideaStatusFromColumnId(id: string): IdeaStatus | null {
  const status = id.replace("idea-column:", "");
  return statusOrder.includes(status as IdeaStatus) ? (status as IdeaStatus) : null;
}

function todoStatusFromColumnId(id: string, scope: "project" | "daily"): TodoStatus | null {
  const status = id.replace(`${scope}-todo-column:`, "");
  return todoStatusOrder.includes(status as TodoStatus) ? (status as TodoStatus) : null;
}

const blankRepository = (): RelatedRepository => ({
  id: createId("repo"),
  name: "",
  type: "other",
  urlOrPath: "",
  note: "",
});

const pathName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const pathExtension = (path: string) => {
  const name = pathName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
};
const repositoryTypeFromFile = (path: string): RepositoryType => {
  const extension = pathExtension(path);
  if (extension === "pdf") return "pdf";
  if (["csv", "tsv", "json", "xlsx", "xls", "parquet", "h5", "hdf5", "nc"].includes(extension ?? "")) return "dataset";
  return "local_file";
};
const normalizeDialogPath = (selected: string | string[] | null) => (Array.isArray(selected) ? selected[0] : selected);

type IdeaMirrorResult = {
  ideaId: string;
  externalIdeaId: string;
  ideaPoolPath: string;
};

type ProjectPromotionResult = {
  projectId: string;
  projectPath: string;
};

function slugifyProjectName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || "untitled_project";
}

function projectRepository(projectId: string, projectPath: string): RelatedRepository {
  return {
    id: createId("repo"),
    name: pathName(projectPath) || projectId,
    type: "local_folder",
    urlOrPath: projectPath,
    note: `Promoted from ${projectId}`,
    indexedAt: new Date().toISOString(),
  };
}

const providerBaseUrls: Record<LlmSettings["provider"], string> = {
  "openai-compatible": "https://api.openai.com/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};

const providerDefaultModels: Record<LlmSettings["provider"], string> = {
  "openai-compatible": "gpt-4.1-mini",
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
};

const anthropicModelPresets = [
  "claude-3-5-sonnet-latest",
  "claude-3-5-haiku-latest",
  "claude-3-opus-latest",
];

const openAiModelPresets = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"];

function defaultModelOptions(provider: LlmSettings["provider"]) {
  return provider === "anthropic" ? anthropicModelPresets : openAiModelPresets;
}

function validateLlmSettings(settings: LlmSettings, options: { requireModel: boolean }) {
  if (!settings.provider) return "请选择 Provider。";
  if (!settings.baseUrl.trim()) return "请填写 Base URL。";
  if (!settings.apiKey.trim()) return "请填写 API Key。";
  if (options.requireModel && !settings.model.trim()) return "请填写或选择 Model。";
  return "";
}

function normalizeLinkedProjectTodos(links: LinkedProjectTodo[] | undefined) {
  const seen = new Set<string>();
  return (links ?? []).filter((link) => {
    const key = `${link.ideaId}:${link.todoId}`;
    if (!link.ideaId || !link.todoId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addLinkedProjectTodo(links: LinkedProjectTodo[] | undefined, link: LinkedProjectTodo) {
  return normalizeLinkedProjectTodos([...(links ?? []), link]);
}

function removeLinkedProjectTodo(links: LinkedProjectTodo[] | undefined, link: LinkedProjectTodo) {
  return normalizeLinkedProjectTodos(links).filter((item) => item.ideaId !== link.ideaId || item.todoId !== link.todoId);
}

function linkedDailyFieldsFromProject(todo: TodoItem, daily: DailyTodo, link: LinkedProjectTodo, now: string): DailyTodo {
  return {
    ...daily,
    title: todo.title,
    description: todo.description,
    status: todo.status,
    priority: todo.priority,
    tags: normalizeTags(todo.tags ?? []),
    completedAt: todo.status === "done" ? todo.completedAt || now : undefined,
    updatedAt: now,
    linkedProjectTodos: addLinkedProjectTodo(daily.linkedProjectTodos, link),
  };
}

function linkedProjectFieldsFromDaily(daily: DailyTodo, todo: TodoItem, now: string): TodoItem {
  return {
    ...todo,
    title: daily.title,
    description: daily.description,
    status: normalizeTodoStatus(daily.status),
    priority: normalizePriority(daily.priority),
    tags: normalizeTags(daily.tags),
    completedAt: daily.status === "done" ? daily.completedAt || now : undefined,
    updatedAt: now,
  };
}

function reorderIdeasForDrop(ideas: Idea[], draggedId: string, targetStatus: IdeaStatus, overId?: string) {
  const dragged = ideas.find((idea) => idea.id === draggedId);
  if (!dragged) return ideas;
  const now = new Date().toISOString();
  const withoutDragged = ideas.filter((idea) => idea.id !== draggedId);
  const nextDragged = { ...dragged, status: targetStatus, updatedAt: now };
  const grouped = new Map<IdeaStatus, Idea[]>();
  statusOrder.forEach((status) => {
    grouped.set(
      status,
      withoutDragged
        .filter((idea) => idea.status === status)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    );
  });
  const targetGroup = [...(grouped.get(targetStatus) ?? [])];
  const overIndex = overId ? targetGroup.findIndex((idea) => idea.id === overId) : -1;
  targetGroup.splice(overIndex >= 0 ? overIndex : targetGroup.length, 0, nextDragged);
  grouped.set(targetStatus, targetGroup);

  const byId = new Map<string, Idea>();
  statusOrder.forEach((status) => {
    (grouped.get(status) ?? []).forEach((idea, order) => {
      byId.set(idea.id, { ...idea, order });
    });
  });
  return ideas.map((idea) => byId.get(idea.id) ?? idea);
}

function reorderTodosForDrop<T extends { id: string; status: TodoStatus; order: number; updatedAt: string; completedAt?: string }>(
  todos: T[],
  draggedId: string,
  targetStatus: TodoStatus,
  overId?: string,
) {
  const dragged = todos.find((todo) => todo.id === draggedId);
  if (!dragged) return todos;
  const now = new Date().toISOString();
  const withoutDragged = todos.filter((todo) => todo.id !== draggedId);
  const nextDragged = {
    ...dragged,
    status: targetStatus,
    completedAt: targetStatus === "done" ? dragged.completedAt || now : undefined,
    updatedAt: now,
  };
  const grouped = new Map<TodoStatus, T[]>();
  todoStatusOrder.forEach((status) => {
    grouped.set(
      status,
      withoutDragged.filter((todo) => todo.status === status).sort((a, b) => a.order - b.order),
    );
  });
  const targetGroup = [...(grouped.get(targetStatus) ?? [])];
  const overIndex = overId ? targetGroup.findIndex((todo) => todo.id === overId) : -1;
  targetGroup.splice(overIndex >= 0 ? overIndex : targetGroup.length, 0, nextDragged as T);
  grouped.set(targetStatus, targetGroup);

  const byId = new Map<string, T>();
  todoStatusOrder.forEach((status) => {
    (grouped.get(status) ?? []).forEach((todo, order) => {
      byId.set(todo.id, { ...todo, order } as T);
    });
  });
  return todos.map((todo) => byId.get(todo.id) ?? todo);
}

function useAppDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

function sortableStyle(transform: ReturnType<typeof CSS.Transform.toString>, transition: string | undefined, isDragging: boolean): CSSProperties {
  return {
    transform: transform ?? undefined,
    transition,
    opacity: isDragging ? 0.58 : 1,
    zIndex: isDragging ? 3 : undefined,
  };
}

function DroppableColumn({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className}${isOver ? " drag-over" : ""}`}>
      {children}
    </div>
  );
}

const createBlankIdea = (): Idea => {
  const now = new Date().toISOString();
  return {
    id: createId("idea"),
    title: "",
    content: emptyIdeaContent,
    plan: emptyIdeaPlan,
    todos: [],
    repositories: [],
    status: "not_started",
    tags: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    order: 0,
    progress: 0,
  };
};

const createBlankProjectTodo = (order: number): TodoItem => {
  const now = new Date().toISOString();
  return {
    id: createId("todo"),
    title: "",
    description: "",
    status: "todo",
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    order,
  };
};

const createBlankDailyTodo = (date: string, order: number): DailyTodo => {
  const now = new Date().toISOString();
  return {
    id: createId("daily"),
    title: "",
    description: "",
    status: "todo",
    priority: "medium",
    date,
    createdAt: now,
    updatedAt: now,
    tags: [],
    order,
  };
};

export default function App() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [dailyTodos, setDailyTodos] = useState<DailyTodo[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [storageReady, setStorageReady] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("research");
  const [view, setView] = useState<ViewMode>("dashboard");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("updated_desc");
  const [selectedId, setSelectedId] = useState("");
  const [selectedDailyDate, setSelectedDailyDate] = useState(todayDateKey());
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null);
  const [editingDailyTodo, setEditingDailyTodo] = useState<DailyTodo | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [localNotice, setLocalNotice] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const mirrorTimerRef = useRef<number | null>(null);
  const t = useMemo(() => createTranslator(settings.language), [settings.language]);

  function showLocalNotice(message: string) {
    setLocalNotice(message);
    window.setTimeout(() => setLocalNotice((current) => (current === message ? "" : current)), 3600);
  }

  useEffect(() => {
    let active = true;
    loadAppData()
      .then((data) => {
        if (!active) return;
        setIdeas(data.ideas);
        setDailyTodos(data.dailyTodos);
        setSettings(data.settings);
        setSelectedId(data.ideas[0]?.id ?? "");
        setStorageReady(true);
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : "读取本地工作区失败。");
        setStorageReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    void saveIdeas(ideas);
    if (mirrorTimerRef.current) window.clearTimeout(mirrorTimerRef.current);
    mirrorTimerRef.current = window.setTimeout(() => {
      void mirrorIdeasToResearchProjects(ideas);
    }, 600);
    return () => {
      if (mirrorTimerRef.current) window.clearTimeout(mirrorTimerRef.current);
    };
  }, [ideas, storageReady]);

  useEffect(() => {
    if (storageReady) void saveDailyTodos(dailyTodos);
  }, [dailyTodos, storageReady]);

  useEffect(() => {
    if (storageReady) void saveSettings(settings);
  }, [settings, storageReady]);

  const allTags = useMemo(
    () => Array.from(new Set(ideas.flatMap((idea) => idea.tags))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [ideas],
  );

  const filteredIdeas = useMemo(
    () => sortIdeas(ideas.filter((idea) => matchesIdea(idea, query, tagFilter, statusFilter)), sortMode),
    [ideas, query, tagFilter, statusFilter, sortMode],
  );

  const selectedIdea = useMemo(
    () => ideas.find((idea) => idea.id === selectedId) ?? filteredIdeas[0] ?? ideas[0],
    [filteredIdeas, ideas, selectedId],
  );

  const stats = useMemo(
    () =>
      statusOrder.map((status) => ({
        status,
        count: ideas.filter((idea) => idea.status === status).length,
      })),
    [ideas],
  );

  const recentIdeas = useMemo(() => sortIdeas(ideas, "updated_desc").slice(0, 5), [ideas]);

  const dailyTodoTags = useMemo(
    () => Array.from(new Set(dailyTodos.flatMap((todo) => todo.tags))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [dailyTodos],
  );

  function changeAppMode(mode: AppMode) {
    setAppMode(mode);
    setView(mode === "research" ? "dashboard" : "daily");
    setQuery("");
  }

  function updateIdea(updatedIdea: Idea) {
    const ideaWithTimestamp = withCalculatedIdeaProgress({ ...updatedIdea, updatedAt: new Date().toISOString() });
    setIdeas((current) => current.map((idea) => (idea.id === ideaWithTimestamp.id ? ideaWithTimestamp : idea)));
    setSelectedId(ideaWithTimestamp.id);
  }

  async function mirrorIdeasToResearchProjects(nextIdeas: Idea[]) {
    if (nextIdeas.length === 0) return;
    try {
      const results = await invoke<IdeaMirrorResult[]>("mirror_research_ideas", { ideas: nextIdeas });
      setIdeas((current) => {
        let changed = false;
        const byId = new Map(results.map((result) => [result.ideaId, result]));
        const merged = current.map((idea) => {
          const result = byId.get(idea.id);
          if (!result) return idea;
          if (idea.externalIdeaId === result.externalIdeaId && idea.ideaPoolPath === result.ideaPoolPath) return idea;
          changed = true;
          return {
            ...idea,
            externalIdeaId: idea.externalIdeaId ?? result.externalIdeaId,
            ideaPoolPath: idea.ideaPoolPath ?? result.ideaPoolPath,
          };
        });
        return changed ? merged : current;
      });
    } catch (error) {
      console.warn("ResearchProjects mirror skipped.", error);
    }
  }

  async function promoteIdeaToProject(idea: Idea) {
    if (idea.projectId && !window.confirm(`Idea 已绑定 ${idea.projectId}。仍要创建另一个项目吗？`)) return;
    let sourceIdea = idea;
    if (!sourceIdea.externalIdeaId || !sourceIdea.ideaPoolPath) {
      try {
        const [result] = await invoke<IdeaMirrorResult[]>("mirror_research_ideas", { ideas: [sourceIdea] });
        if (result) {
          sourceIdea = { ...sourceIdea, externalIdeaId: result.externalIdeaId, ideaPoolPath: result.ideaPoolPath };
          setIdeas((current) => current.map((item) => (item.id === sourceIdea.id ? sourceIdea : item)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message.includes("__TAURI__") ? "Project promotion requires the Tauri desktop runtime." : message || "创建项目失败。");
        return;
      }
    }
    const defaultProjectId = sourceIdea.projectId || "P001";
    const projectId = window.prompt("Project ID，例如 P001", defaultProjectId)?.trim();
    if (!projectId) return;
    const projectName = window.prompt("Project name，例如 tri_layer_wavy_microchannel", slugifyProjectName(sourceIdea.title))?.trim();
    if (!projectName) return;
    const mainTool = window.prompt("Main tool，例如 Fluent", "")?.trim() ?? "";
    const projectType = window.prompt("Project type，例如 CFD", "")?.trim() ?? "";
    const notes = window.prompt("Project index notes", `Promoted from ${sourceIdea.externalIdeaId ?? sourceIdea.id}`)?.trim() ?? "";

    try {
      const result = await invoke<ProjectPromotionResult>("promote_idea_to_project", {
        input: { idea: sourceIdea, projectId, projectName, mainTool, projectType, notes },
      });
      const repo = projectRepository(sourceIdea.externalIdeaId ?? sourceIdea.id, result.projectPath);
      setIdeas((current) =>
        current.map((item) => {
          if (item.id !== sourceIdea.id) return item;
          const hasRepo = item.repositories.some((existing) => existing.urlOrPath === result.projectPath);
          return {
            ...item,
            projectId: result.projectId,
            projectPath: result.projectPath,
            repositories: hasRepo ? item.repositories : [...item.repositories, repo],
            updatedAt: new Date().toISOString(),
          };
        }),
      );
      showLocalNotice(`已创建项目 ${result.projectId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(message.includes("__TAURI__") ? "Project promotion requires the Tauri desktop runtime." : message || "创建项目失败。");
    }
  }

  function saveModalIdea(idea: Idea) {
    const now = new Date().toISOString();
    const normalized: Idea = {
      ...idea,
      title: idea.title.trim() || "未命名科研 idea",
      tags: normalizeTags(idea.tags),
      todos: idea.todos ?? [],
      repositories: idea.repositories.filter((repo) => repo.name.trim() || repo.urlOrPath.trim()),
      updatedAt: now,
      createdAt: idea.createdAt || now,
      order: Number.isFinite(idea.order) ? idea.order : ideas.length,
    };
    const normalizedWithProgress = withCalculatedIdeaProgress(normalized);

    setIdeas((current) => {
      const exists = current.some((item) => item.id === normalizedWithProgress.id);
      return exists
        ? current.map((item) => (item.id === normalizedWithProgress.id ? normalizedWithProgress : item))
        : [normalizedWithProgress, ...current];
    });
    setSelectedId(normalizedWithProgress.id);
    setEditingIdea(null);
  }

  function changeIdeaStatus(id: string, status: IdeaStatus) {
    setIdeas((current) =>
      current.map((idea) => (idea.id === id ? { ...idea, status, updatedAt: new Date().toISOString() } : idea)),
    );
  }

  function moveIdeaOnBoard(id: string, status: IdeaStatus, overId?: string) {
    setIdeas((current) => reorderIdeasForDrop(current, id, status, overId));
  }

  function deleteIdea(id: string) {
    const target = ideas.find((idea) => idea.id === id);
    if (!target) return;
    if (window.confirm(`确认永久删除「${target.title}」吗？建议只在确定不需要复盘时删除。`)) {
      const remaining = ideas.filter((idea) => idea.id !== id);
      setIdeas(remaining);
      setSelectedId(remaining[0]?.id ?? "");
    }
  }

  function saveProjectTodo(ideaId: string, todo: TodoItem) {
    const now = new Date().toISOString();
    const link = todo.link?.type === "daily_todo" ? todo.link : undefined;
    const linkedDaily = link ? dailyTodos.find((item) => item.id === link.dailyTodoId && item.date === link.dailyTodoDate) : undefined;
    if (link && !linkedDaily) {
      showLocalNotice(t("link.missingDaily"));
    }

    let normalizedForLink: TodoItem | null = null;
    const nextIdeas = ideas.map((idea) => {
        if (idea.id !== ideaId) return idea;
        const todos = idea.todos ?? [];
        const status = normalizeTodoStatus(todo.status);
        const normalizedTodo: TodoItem = {
          ...todo,
          title: todo.title.trim() || "未命名任务",
          description: todo.description?.trim() || undefined,
          status,
          priority: normalizePriority(todo.priority),
          dueDate: todo.dueDate || undefined,
          completedAt: status === "done" ? todo.completedAt || now : undefined,
          updatedAt: now,
          order: Number.isFinite(todo.order) ? todo.order : todos.length,
          link: linkedDaily ? link : undefined,
        };
        normalizedForLink = normalizedTodo;
        const exists = todos.some((item) => item.id === normalizedTodo.id);
        const nextTodos = exists
          ? todos.map((item) => (item.id === normalizedTodo.id ? normalizedTodo : item))
          : [...todos, normalizedTodo];
        return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
      });
    setIdeas(nextIdeas);

    if (linkedDaily && normalizedForLink) {
      setDailyTodos((current) =>
        sortDailyTodos(
          current.map((item) =>
            item.id === linkedDaily.id && item.date === linkedDaily.date
              ? linkedDailyFieldsFromProject(normalizedForLink as TodoItem, item, { ideaId, todoId: (normalizedForLink as TodoItem).id }, now)
              : item,
          ),
        ),
      );
    }
  }

  function changeProjectTodoStatus(ideaId: string, todoId: string, status: TodoStatus) {
    let linkedUpdate: TodoItem | null = null;
    const nextIdeas = ideas.map((idea) => {
        if (idea.id !== ideaId) return idea;
        const now = new Date().toISOString();
        const nextTodos = (idea.todos ?? []).map((todo) => {
          if (todo.id !== todoId) return todo;
          const nextTodo = {
            ...todo,
            status,
            completedAt: status === "done" ? todo.completedAt || now : undefined,
            updatedAt: now,
          };
          linkedUpdate = nextTodo;
          return nextTodo;
        });
        return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
      });
    setIdeas(nextIdeas);
    const projectUpdate = linkedUpdate as TodoItem | null;
    if (projectUpdate?.link) {
      const link = projectUpdate.link;
      const target = dailyTodos.find((todo) => todo.id === link.dailyTodoId && todo.date === link.dailyTodoDate);
      if (!target) {
        showLocalNotice(t("link.missingDaily"));
        unlinkProjectTodo(ideaId, todoId);
        return;
      }
      const now = new Date().toISOString();
      setDailyTodos((current) =>
        sortDailyTodos(current.map((todo) => (todo.id === target.id ? linkedDailyFieldsFromProject(projectUpdate, todo, { ideaId, todoId }, now) : todo))),
      );
    }
  }

  function deleteProjectTodo(ideaId: string, todoId: string) {
    const targetIdea = ideas.find((idea) => idea.id === ideaId);
    const targetTodo = targetIdea?.todos.find((todo) => todo.id === todoId);
    if (!targetTodo) return;
    if (targetTodo.link) {
      const choice = chooseLinkedDelete();
      if (choice === "cancel") return;
      if (choice === "unlink") {
        unlinkProjectTodo(ideaId, todoId);
        return;
      }
      deleteLinkedProjectTodoPair(ideaId, todoId, targetTodo.link.dailyTodoId);
      return;
    }
    if (!window.confirm(t("error.deleteProjectTodo"))) return;
    setIdeas((current) =>
      current.map((idea) => {
        if (idea.id !== ideaId) return idea;
        const now = new Date().toISOString();
        const nextTodos = (idea.todos ?? [])
          .filter((todo) => todo.id !== todoId)
          .map((todo, index) => ({ ...todo, order: index }));
        return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
      }),
    );
  }

  function chooseLinkedDelete(): "unlink" | "deleteBoth" | "cancel" {
    const answer = window.prompt(t("link.deletePrompt"), "1");
    if (answer === null || answer.trim() === "3") return "cancel";
    if (answer.trim() === "2") return "deleteBoth";
    return "unlink";
  }

  function unlinkProjectTodo(ideaId: string, todoId: string) {
    const removedDailyId = ideas.find((idea) => idea.id === ideaId)?.todos.find((todo) => todo.id === todoId)?.link?.dailyTodoId ?? "";
    setIdeas((current) =>
      current.map((idea) => {
        if (idea.id !== ideaId) return idea;
        const now = new Date().toISOString();
        const nextTodos = (idea.todos ?? []).map((todo) => {
          if (todo.id !== todoId) return todo;
          return { ...todo, link: undefined, updatedAt: now };
        });
        return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
      }),
    );
    if (removedDailyId) {
      setDailyTodos((current) =>
        sortDailyTodos(
          current.map((todo) =>
            todo.id === removedDailyId
              ? { ...todo, linkedProjectTodos: removeLinkedProjectTodo(todo.linkedProjectTodos, { ideaId, todoId }), updatedAt: new Date().toISOString() }
              : todo,
          ),
        ),
      );
    }
  }

  function unlinkDailyTodo(id: string) {
    const target = dailyTodos.find((todo) => todo.id === id);
    if (!target) return;
    const links = normalizeLinkedProjectTodos(target.linkedProjectTodos);
    setDailyTodos((current) => sortDailyTodos(current.map((todo) => (todo.id === id ? { ...todo, linkedProjectTodos: [], updatedAt: new Date().toISOString() } : todo))));
    if (links.length) {
      setIdeas((current) =>
        current.map((idea) => {
          const nextTodos = (idea.todos ?? []).map((todo) =>
            links.some((link) => link.ideaId === idea.id && link.todoId === todo.id) ? { ...todo, link: undefined, updatedAt: new Date().toISOString() } : todo,
          );
          return nextTodos === idea.todos ? idea : withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: new Date().toISOString() });
        }),
      );
    }
  }

  function deleteLinkedProjectTodoPair(ideaId: string, todoId: string, dailyTodoId: string) {
    setIdeas((current) =>
      current.map((idea) => {
        if (idea.id !== ideaId) return idea;
        const now = new Date().toISOString();
        const nextTodos = (idea.todos ?? []).filter((todo) => todo.id !== todoId).map((todo, index) => ({ ...todo, order: index }));
        return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
      }),
    );
    setDailyTodos((current) => sortDailyTodos(current.filter((todo) => todo.id !== dailyTodoId)));
  }

  function moveProjectTodo(ideaId: string, todoId: string, direction: -1 | 1) {
    setIdeas((current) =>
      current.map((idea) => {
        if (idea.id !== ideaId) return idea;
        const todos = [...(idea.todos ?? [])].sort((a, b) => a.order - b.order);
        const index = todos.findIndex((todo) => todo.id === todoId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= todos.length) return idea;
        [todos[index], todos[nextIndex]] = [todos[nextIndex], todos[index]];
        const now = new Date().toISOString();
        return withCalculatedIdeaProgress({
          ...idea,
          todos: todos.map((todo, order) => ({ ...todo, order, updatedAt: todo.id === todoId ? now : todo.updatedAt })),
          updatedAt: now,
        });
      }),
    );
  }

  function moveProjectTodoToStatus(ideaId: string, todoId: string, status: TodoStatus, overId?: string) {
    let linkedUpdate: TodoItem | null = null;
    const nextIdeas = ideas.map((idea) => {
        if (idea.id !== ideaId) return idea;
        const now = new Date().toISOString();
        const nextTodos = reorderTodosForDrop(idea.todos ?? [], todoId, status, overId);
        linkedUpdate = nextTodos.find((todo) => todo.id === todoId) ?? null;
        return withCalculatedIdeaProgress({ ...idea, todos: nextTodos.map((todo) => ({ ...todo, updatedAt: todo.id === todoId ? now : todo.updatedAt })), updatedAt: now });
      });
    setIdeas(nextIdeas);
    const projectUpdate = linkedUpdate as TodoItem | null;
    if (projectUpdate?.link) {
      const link = projectUpdate.link;
      const target = dailyTodos.find((todo) => todo.id === link.dailyTodoId && todo.date === link.dailyTodoDate);
      if (!target) {
        showLocalNotice(t("link.missingDaily"));
        unlinkProjectTodo(ideaId, todoId);
        return;
      }
      const now = new Date().toISOString();
      setDailyTodos((current) =>
        sortDailyTodos(current.map((todo) => (todo.id === target.id ? linkedDailyFieldsFromProject(projectUpdate, todo, { ideaId, todoId }, now) : todo))),
      );
    }
  }

  function saveDailyTodo(todo: DailyTodo) {
    const now = new Date().toISOString();
    const status = normalizeTodoStatus(todo.status);
    const validLinks = normalizeLinkedProjectTodos(todo.linkedProjectTodos).filter((link) =>
      ideas.some((idea) => idea.id === link.ideaId && idea.todos.some((projectTodo) => projectTodo.id === link.todoId)),
    );
    if ((todo.linkedProjectTodos ?? []).length !== validLinks.length) {
      showLocalNotice(t("link.missingProject"));
    }
    const normalizedTodo: DailyTodo = {
      ...todo,
      title: todo.title.trim() || "未命名任务",
      description: todo.description?.trim() || undefined,
      status,
      priority: normalizePriority(todo.priority),
      date: todo.date || selectedDailyDate,
      tags: normalizeTags(todo.tags),
      completedAt: status === "done" ? todo.completedAt || now : undefined,
      createdAt: todo.createdAt || now,
      updatedAt: now,
      order: Number.isFinite(todo.order) ? todo.order : dailyTodos.filter((item) => item.date === (todo.date || selectedDailyDate)).length,
      linkedProjectTodos: validLinks,
    };
    setDailyTodos((current) => {
      const exists = current.some((item) => item.id === normalizedTodo.id);
      return sortDailyTodos(exists ? current.map((item) => (item.id === normalizedTodo.id ? normalizedTodo : item)) : [...current, normalizedTodo]);
    });
    if (validLinks.length) {
      setIdeas((current) =>
        current.map((idea) => {
          const nextTodos = (idea.todos ?? []).map((projectTodo) =>
            validLinks.some((link) => link.ideaId === idea.id && link.todoId === projectTodo.id)
              ? linkedProjectFieldsFromDaily(normalizedTodo, projectTodo, now)
              : projectTodo,
          );
          return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
        }),
      );
    }
    setEditingDailyTodo(null);
  }

  function changeDailyTodoStatus(id: string, status: DailyTodoStatus) {
    let changedTodo: DailyTodo | null = null;
    const nextDailyTodos = sortDailyTodos(
        dailyTodos.map((todo) => {
          if (todo.id !== id) return todo;
          const now = new Date().toISOString();
          changedTodo = {
            ...todo,
            status,
            completedAt: status === "done" ? todo.completedAt || now : undefined,
            updatedAt: now,
          };
          return changedTodo;
        }),
    );
    setDailyTodos(nextDailyTodos);
    const dailyUpdate = changedTodo as DailyTodo | null;
    if (dailyUpdate?.linkedProjectTodos?.length) {
      const now = new Date().toISOString();
      const validLinks = normalizeLinkedProjectTodos(dailyUpdate.linkedProjectTodos);
      setIdeas((current) =>
        current.map((idea) => {
          const nextTodos = (idea.todos ?? []).map((projectTodo) =>
            validLinks.some((link) => link.ideaId === idea.id && link.todoId === projectTodo.id)
              ? linkedProjectFieldsFromDaily(dailyUpdate, projectTodo, now)
              : projectTodo,
          );
          return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
        }),
      );
    }
  }

  function deleteDailyTodo(id: string) {
    const target = dailyTodos.find((todo) => todo.id === id);
    if (!target) return;
    const links = normalizeLinkedProjectTodos(target.linkedProjectTodos);
    if (links.length) {
      const choice = chooseLinkedDelete();
      if (choice === "cancel") return;
      if (choice === "unlink") {
        unlinkDailyTodo(id);
        return;
      }
      setDailyTodos((current) => current.filter((todo) => todo.id !== id));
      setIdeas((current) =>
        current.map((idea) => {
          const now = new Date().toISOString();
          const nextTodos = (idea.todos ?? [])
            .filter((projectTodo) => !links.some((link) => link.ideaId === idea.id && link.todoId === projectTodo.id))
            .map((projectTodo, index) => ({ ...projectTodo, order: index }));
          return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
        }),
      );
      return;
    }
    if (!window.confirm(t("error.deleteDailyTodo"))) return;
    setDailyTodos((current) => current.filter((todo) => todo.id !== id));
  }

  function moveDailyTodo(id: string, direction: -1 | 1) {
    setDailyTodos((current) => {
      const target = current.find((todo) => todo.id === id);
      if (!target) return current;
      const sameDate = current.filter((todo) => todo.date === target.date).sort((a, b) => a.order - b.order);
      const index = sameDate.findIndex((todo) => todo.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= sameDate.length) return current;
      [sameDate[index], sameDate[nextIndex]] = [sameDate[nextIndex], sameDate[index]];
      const orderMap = new Map(sameDate.map((todo, order) => [todo.id, order]));
      const now = new Date().toISOString();
      return sortDailyTodos(
        current.map((todo) =>
          orderMap.has(todo.id) ? { ...todo, order: orderMap.get(todo.id) ?? todo.order, updatedAt: todo.id === id ? now : todo.updatedAt } : todo,
        ),
      );
    });
  }

  function moveDailyTodoToStatus(id: string, status: DailyTodoStatus, overId?: string) {
    let changedTodo: DailyTodo | null = null;
    const target = dailyTodos.find((todo) => todo.id === id);
    if (!target) return;
    const sameDate = dailyTodos.filter((todo) => todo.date === target.date);
      const movedSameDate = reorderTodosForDrop(sameDate, id, status, overId);
      changedTodo = movedSameDate.find((todo) => todo.id === id) ?? null;
      const byId = new Map(movedSameDate.map((todo) => [todo.id, todo]));
    setDailyTodos(sortDailyTodos(dailyTodos.map((todo) => byId.get(todo.id) ?? todo)));
    const dailyUpdate = changedTodo as DailyTodo | null;
    if (dailyUpdate?.linkedProjectTodos?.length) {
      const now = new Date().toISOString();
      const validLinks = normalizeLinkedProjectTodos(dailyUpdate.linkedProjectTodos);
      setIdeas((current) =>
        current.map((idea) => {
          const nextTodos = (idea.todos ?? []).map((projectTodo) =>
            validLinks.some((link) => link.ideaId === idea.id && link.todoId === projectTodo.id)
              ? linkedProjectFieldsFromDaily(dailyUpdate, projectTodo, now)
              : projectTodo,
          );
          return withCalculatedIdeaProgress({ ...idea, todos: nextTodos, updatedAt: now });
        }),
      );
    }
  }

  function clearDoneDailyTodos(date: string) {
    if (!window.confirm(t("error.clearDone"))) return;
    const linkedDoneCount = dailyTodos.filter((todo) => todo.date === date && todo.status === "done" && normalizeLinkedProjectTodos(todo.linkedProjectTodos).length > 0).length;
    if (linkedDoneCount) showLocalNotice(t("link.clearDoneSkipped", { count: linkedDoneCount }));
    setDailyTodos((current) =>
      current.filter((todo) => todo.date !== date || todo.status !== "done" || normalizeLinkedProjectTodos(todo.linkedProjectTodos).length > 0),
    );
  }

  function importDailyTodosToIdea(ideaId: string, selectedTodos: DailyTodo[], linked: boolean) {
    if (selectedTodos.length === 0) return;
    const createdLinks: Array<{ dailyId: string; projectTodoId: string }> = [];
    setIdeas((current) =>
      current.map((idea) => {
        if (idea.id !== ideaId) return idea;
        const now = new Date().toISOString();
        const startOrder = (idea.todos ?? []).length;
        const importedTodos = selectedTodos.map((todo, index) => {
          const projectTodo = projectTodoFromDailyTodo(todo, startOrder + index, linked);
          if (linked) createdLinks.push({ dailyId: todo.id, projectTodoId: projectTodo.id });
          return projectTodo;
        });
        return withCalculatedIdeaProgress({
          ...idea,
          todos: [...(idea.todos ?? []), ...importedTodos],
          updatedAt: now,
        });
      }),
    );
    if (linked && createdLinks.length) {
      setDailyTodos((current) =>
        sortDailyTodos(
          current.map((todo) => {
            const link = createdLinks.find((item) => item.dailyId === todo.id);
            return link ? { ...todo, linkedProjectTodos: addLinkedProjectTodo(todo.linkedProjectTodos, { ideaId, todoId: link.projectTodoId }) } : todo;
          }),
        ),
      );
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importDataFromFile(file);
      setIdeas(imported.ideas);
      setDailyTodos(imported.dailyTodos);
      setSelectedId(imported.ideas[0]?.id ?? "");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导入失败。");
    } finally {
      event.target.value = "";
    }
  }

  async function openRepository(repo: RelatedRepository) {
    if (/^https?:\/\//i.test(repo.urlOrPath)) {
      void openShell(repo.urlOrPath);
      return;
    }
    if (!repo.urlOrPath.trim()) return;
    try {
      await invoke("open_local_path", { path: repo.urlOrPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(message.includes("__TAURI__") ? "Opening local files requires the Tauri desktop runtime." : message || "Unable to open this path.");
    }
  }

  function copyRepositoryPath(repo: RelatedRepository) {
    navigator.clipboard?.writeText(repo.urlOrPath);
  }

  async function revealRepository(repo: RelatedRepository) {
    if (/^https?:\/\//i.test(repo.urlOrPath) || !repo.urlOrPath.trim()) return;
    try {
      await invoke("reveal_in_folder", { path: repo.urlOrPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(message.includes("__TAURI__") ? "Opening local files requires the Tauri desktop runtime." : message || "Unable to reveal this path.");
    }
  }

  const shellClass = settings.theme === "dark" ? "theme-dark" : "theme-light";

  return (
    <I18nProvider value={t}>
    <main className={`app-shell ${shellClass}`}>
      <Sidebar
        appMode={appMode}
        ideas={ideas}
        view={view}
        statusFilter={statusFilter}
        tagFilter={tagFilter}
        allTags={allTags}
        dailyTodos={dailyTodos}
        onModeChange={changeAppMode}
        onViewChange={setView}
        onStatusFilter={(status) => {
          setStatusFilter(status);
          setView("list");
        }}
        onTagFilter={(tag) => {
          setTagFilter(tag);
          setView("list");
        }}
      />

      <section className="workspace">
        <Header
          appMode={appMode}
          view={view}
          statusFilter={statusFilter}
          query={query}
          sortMode={sortMode}
          onQueryChange={setQuery}
          onSortChange={setSortMode}
          onNewIdea={() => setEditingIdea(createBlankIdea())}
          onAiNewIdea={() => setAiModalOpen(true)}
          onBoard={() => setView("board")}
        />

        {appMode === "research" && view === "dashboard" && (
          <Dashboard
            stats={stats}
            recentIdeas={recentIdeas}
            ideas={ideas}
            onNewIdea={() => setEditingIdea(createBlankIdea())}
            onAiNewIdea={() => setAiModalOpen(true)}
            onSelect={(idea) => {
              setSelectedId(idea.id);
              setStatusFilter("all");
              setView("list");
            }}
            onStatusSelect={(status) => {
              setStatusFilter(status);
              setView("list");
            }}
          />
        )}

        {appMode === "research" && view === "board" && (
          <IdeasBoard
            ideas={filteredIdeas}
            onSelect={(idea) => setSelectedId(idea.id)}
            onEdit={(idea) => setEditingIdea(idea)}
            onMoveIdea={moveIdeaOnBoard}
          />
        )}

        {appMode === "research" && view === "list" && (
          <section className="content-grid">
            <IdeaList
              ideas={filteredIdeas}
              selectedId={selectedIdea?.id}
              onSelect={(idea) => setSelectedId(idea.id)}
              onNewIdea={() => setEditingIdea(createBlankIdea())}
              onCycleStatus={(idea) => changeIdeaStatus(idea.id, nextStatus(idea.status))}
            />
            <IdeaDetail
              idea={selectedIdea}
              onEdit={(idea) => setEditingIdea(idea)}
              onDelete={deleteIdea}
              onAbandon={(idea) => changeIdeaStatus(idea.id, "abandoned")}
              onPromote={promoteIdeaToProject}
              onStatusChange={changeIdeaStatus}
              onSaveTodo={saveProjectTodo}
              onChangeTodoStatus={changeProjectTodoStatus}
              onDeleteTodo={deleteProjectTodo}
              onMoveTodo={moveProjectTodo}
              onDropTodo={moveProjectTodoToStatus}
              dailyTodos={dailyTodos}
              onImportDailyTodos={importDailyTodosToIdea}
              llmSettings={settings.llm}
              onOpenRepository={openRepository}
              onCopyRepository={copyRepositoryPath}
              onRevealRepository={revealRepository}
            />
          </section>
        )}

        {appMode === "daily" && view === "daily" && (
          <DailyTodoPage
            todos={dailyTodos}
            selectedDate={selectedDailyDate}
            allTags={dailyTodoTags}
            onDateChange={setSelectedDailyDate}
            onNewTodo={() =>
              setEditingDailyTodo(
                createBlankDailyTodo(selectedDailyDate, dailyTodos.filter((todo) => todo.date === selectedDailyDate).length),
              )
            }
            onEditTodo={setEditingDailyTodo}
            onStatusChange={changeDailyTodoStatus}
            onDeleteTodo={deleteDailyTodo}
            onMoveTodo={moveDailyTodo}
            onDropTodo={moveDailyTodoToStatus}
            onClearDone={clearDoneDailyTodos}
            onAddAiTodos={(drafts) => {
              const generated = draftTodosToDailyTodos(
                drafts,
                selectedDailyDate,
                dailyTodos.filter((todo) => todo.date === selectedDailyDate).length,
              );
              setDailyTodos((current) => sortDailyTodos([...current, ...generated]));
            }}
            llmSettings={settings.llm}
          />
        )}

        {view === "settings" && (
          <SettingsPage
            settings={settings}
            ideaCount={ideas.length}
            onSettingsChange={setSettings}
            onExport={() => exportData(ideas, dailyTodos)}
            onImport={() => importInputRef.current?.click()}
          />
        )}
      </section>

      <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />

      {localNotice && <div className="local-notice">{localNotice}</div>}

      {aiModalOpen && (
        <AIIdeaModal
          llmSettings={settings.llm}
          onClose={() => setAiModalOpen(false)}
          onInsert={(draft) => {
            setEditingIdea(draftToIdea(draft));
            setAiModalOpen(false);
          }}
        />
      )}

      {editingIdea && (
        <IdeaEditorModal
          idea={editingIdea}
          llmSettings={settings.llm}
          onClose={() => setEditingIdea(null)}
          onSave={saveModalIdea}
        />
      )}

      {editingDailyTodo && (
        <DailyTodoEditorModal
          todo={editingDailyTodo}
          onClose={() => setEditingDailyTodo(null)}
          onSave={saveDailyTodo}
        />
      )}
    </main>
    </I18nProvider>
  );
}

function Sidebar({
  appMode,
  ideas,
  view,
  statusFilter,
  tagFilter,
  allTags,
  dailyTodos,
  onModeChange,
  onViewChange,
  onStatusFilter,
  onTagFilter,
}: {
  appMode: AppMode;
  ideas: Idea[];
  view: ViewMode;
  statusFilter: StatusFilter;
  tagFilter: string;
  allTags: string[];
  dailyTodos: DailyTodo[];
  onModeChange: (mode: AppMode) => void;
  onViewChange: (view: ViewMode) => void;
  onStatusFilter: (status: StatusFilter) => void;
  onTagFilter: (tag: string) => void;
}) {
  const t = useI18n();
  const todayTodos = dailyTodos.filter((todo) => todo.date === todayDateKey());
  const todayDone = todayTodos.filter((todo) => todo.status === "done").length;

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">
          <img src="/assets/app-icon.png" alt="" />
        </div>
        <div>
          <p className="brand-title">NEW IDEAS</p>
          <p className="brand-subtitle">Research Idea Lab</p>
        </div>
      </div>

      <div className="workspace-switcher" aria-label="Workspace mode">
        <button className={appMode === "research" ? "active" : ""} onClick={() => onModeChange("research")}>
          <Layers3 size={16} />
          {t("app.research")}
        </button>
        <button className={appMode === "daily" ? "active" : ""} onClick={() => onModeChange("daily")}>
          <ListTodo size={16} />
          {t("app.daily")}
        </button>
      </div>

      {appMode === "research" ? (
        <>
          <nav className="nav-section">
            <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => onViewChange("dashboard")}>
              <Home size={18} />
              <span>{t("nav.dashboard")}</span>
            </button>
            <button className={`nav-item ${view === "board" ? "active" : ""}`} onClick={() => onViewChange("board")}>
              <Layers3 size={18} />
              <span>{t("nav.board")}</span>
            </button>
          </nav>

          <div className="sidebar-label">{t("nav.status")}</div>
          <nav className="nav-section">
            <button className={`nav-item ${statusFilter === "all" && view === "list" ? "active" : ""}`} onClick={() => onStatusFilter("all")}>
              <Archive size={18} />
              <span>{t("header.list.title")}</span>
              <strong>{ideas.length}</strong>
            </button>
            {statusOrder.map((status) => {
              const Icon = statusMeta[status].icon;
              const count = ideas.filter((idea) => idea.status === status).length;
              return (
                <button
                  key={status}
                  className={`nav-item ${statusFilter === status && view === "list" ? "active" : ""}`}
                  onClick={() => onStatusFilter(status)}
                >
                  <Icon size={18} />
                  <span>{t(`status.${status}` as any)}</span>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-label">{t("nav.tags")}</div>
          <div className="tag-cloud">
            <button className={`mini-chip ${tagFilter === "all" ? "selected" : ""}`} onClick={() => onTagFilter("all")}>
              {t("common.all")}
            </button>
            {allTags.slice(0, 14).map((tag) => (
              <button key={tag} className={`mini-chip ${tagFilter === tag ? "selected" : ""}`} onClick={() => onTagFilter(tag)}>
                {tag}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <nav className="nav-section">
            <button className={`nav-item ${view === "daily" ? "active" : ""}`} onClick={() => onViewChange("daily")}>
              <CalendarDays size={18} />
              <span>{t("common.today")}</span>
              <strong>
                {todayDone}/{todayTodos.length}
              </strong>
            </button>
          </nav>
          <div className="sidebar-label">{t("app.daily")}</div>
          <div className="daily-sidebar-summary">
            <strong>{todayTodos.length}</strong>
            <span>{t("daily.total")}</span>
            <small>{todayTodos.length ? Math.round((todayDone / todayTodos.length) * 100) : 0}% {t("daily.rate")}</small>
          </div>
        </>
      )}

      <button className={`settings-link ${view === "settings" ? "active" : ""}`} onClick={() => onViewChange("settings")}>
        <Settings size={18} />
        <span>{t("nav.settings")}</span>
      </button>
    </aside>
  );
}

function Header({
  appMode,
  view,
  statusFilter,
  query,
  sortMode,
  onQueryChange,
  onSortChange,
  onNewIdea,
  onAiNewIdea,
  onBoard,
}: {
  appMode: AppMode;
  view: ViewMode;
  statusFilter: StatusFilter;
  query: string;
  sortMode: SortMode;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: SortMode) => void;
  onNewIdea: () => void;
  onAiNewIdea: () => void;
  onBoard: () => void;
}) {
  const t = useI18n();
  const title =
    view === "settings"
      ? t("header.settings.title")
      : appMode === "daily"
      ? t("header.daily.title")
      : view === "dashboard"
      ? t("header.dashboard.title")
      : view === "board"
        ? t("header.board.title")
        : statusFilter === "all"
            ? t("header.list.title")
            : t(`status.${statusFilter}` as any);

  const subtitle =
    view === "settings"
      ? t("header.settings.subtitle")
      : appMode === "daily"
      ? t("header.daily.subtitle")
      : view === "board"
        ? t("header.board.subtitle")
        : view === "dashboard"
          ? t("header.dashboard.subtitle")
          : statusFilter === "all"
            ? t("header.list.subtitle")
            : statusMeta[statusFilter].description;

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{appMode === "daily" ? t("header.daily") : t("header.research")}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      {appMode === "research" && view !== "settings" && (
        <div className="topbar-actions">
          <label className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("common.search")} />
          </label>

          <label className="select-box">
            <ArrowDownAZ size={17} />
            <select value={sortMode} onChange={(event) => onSortChange(event.target.value as SortMode)}>
              <option value="updated_desc">最近更新</option>
              <option value="priority_desc">优先级</option>
              <option value="created_desc">创建时间</option>
              <option value="title_asc">标题 A-Z</option>
            </select>
          </label>

          <button className="ghost-button" onClick={onBoard}>
            <Layers3 size={18} />
            {t("nav.board")}
          </button>
          <button className="ghost-button ai-button" onClick={onAiNewIdea}>
            <Sparkles size={18} />
            {t("idea.ai_new")}
          </button>
          <button className="primary-button" onClick={onNewIdea}>
            <Plus size={18} />
            {t("idea.new")}
          </button>
        </div>
      )}
    </header>
  );
}

function Dashboard({
  stats,
  recentIdeas,
  ideas,
  onNewIdea,
  onAiNewIdea,
  onSelect,
  onStatusSelect,
}: {
  stats: { status: IdeaStatus; count: number }[];
  recentIdeas: Idea[];
  ideas: Idea[];
  onNewIdea: () => void;
  onAiNewIdea: () => void;
  onSelect: (idea: Idea) => void;
  onStatusSelect: (status: IdeaStatus) => void;
}) {
  const t = useI18n();
  const highPriority = ideas.filter((idea) => idea.priority === "high").length;
  const averageProgress = ideas.length
    ? Math.round(ideas.reduce((sum, idea) => sum + Number(idea.progress ?? 0), 0) / ideas.length)
    : 0;

  return (
    <section className="dashboard">
      <div className="overview-band">
        <div>
          <p className="eyebrow">Idea pipeline</p>
          <h2>{t("dashboard.hero.title")}</h2>
          <p>{t("dashboard.hero.body")}</p>
        </div>
        <div className="hero-actions">
          <button className="ghost-button ai-button" onClick={onAiNewIdea}>
            <Sparkles size={18} />
            {t("idea.ai_new")}
          </button>
          <button className="primary-button" onClick={onNewIdea}>
            <Plus size={18} />
            {t("idea.new")}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map(({ status, count }) => {
          const Icon = statusMeta[status].icon;
          return (
            <button key={status} className="stat-tile" onClick={() => onStatusSelect(status)}>
              <span className={`status-rail ${statusMeta[status].accent}`} />
              <Icon size={21} />
              <strong>{count}</strong>
              <span>{statusMeta[status].shortLabel}</span>
            </button>
          );
        })}
        <div className="stat-tile quiet">
          <Sparkles size={21} />
          <strong>{highPriority}</strong>
          <span>高优先级</span>
        </div>
        <div className="stat-tile quiet">
          <Check size={21} />
          <strong>{averageProgress}%</strong>
          <span>平均进度</span>
        </div>
      </div>

      <section className="recent-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Recent updates</p>
            <h2>最近推进</h2>
          </div>
          <MoreHorizontal size={22} />
        </div>
        <div className="recent-list">
          {recentIdeas.map((idea) => (
            <button key={idea.id} className="recent-row" onClick={() => onSelect(idea)}>
              <div>
                <strong>{idea.title}</strong>
                <span>{summarizeMarkdown(idea.content, 96)}</span>
              </div>
              <StatusChip status={idea.status} />
              <PriorityChip priority={idea.priority} />
              <span>{formatDate(idea.updatedAt)}</span>
              <ChevronRight size={18} />
            </button>
          ))}
          {recentIdeas.length === 0 && (
            <div className="recent-empty">
              <img src="/assets/empty-state.png" alt="" />
              <strong>还没有科研 idea，可创建第一个灵感。</strong>
              <span>可以手动新建，也可以用 AI 从一句自然语言描述开始整理。</span>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function IdeaList({
  ideas,
  selectedId,
  onSelect,
  onNewIdea,
  onCycleStatus,
}: {
  ideas: Idea[];
  selectedId?: string;
  onSelect: (idea: Idea) => void;
  onNewIdea: () => void;
  onCycleStatus: (idea: Idea) => void;
}) {
  if (ideas.length === 0) {
    return (
      <section className="idea-list empty-panel">
        <img src="/assets/empty-state.png" alt="" />
        <h2>还没有科研 idea，可创建第一个灵感。</h2>
        <p>空列表会显示在这里。新建一个 idea 后，就可以持续补充内容、计划和文档仓库。</p>
        <button className="primary-button" onClick={onNewIdea}>
          <Plus size={18} />
          新建 Idea
        </button>
      </section>
    );
  }

  return (
    <section className="idea-list">
      {ideas.map((idea) => (
        <button key={idea.id} className={`idea-card ${selectedId === idea.id ? "selected" : ""}`} onClick={() => onSelect(idea)}>
          {(() => {
            const todoSummary = todoCompletionSummary(idea.todos);
            const progress = calculateTodoProgress(idea.todos);
            return (
              <>
          <div className="card-topline">
            <StatusChip status={idea.status} onClick={(event) => {
              event.stopPropagation();
              onCycleStatus(idea);
            }} />
            <PriorityChip priority={idea.priority} />
          </div>
          <h3>{idea.title}</h3>
          <p>{summarizeMarkdown(idea.content)}</p>
          <div className="tag-row">
            {idea.tags.slice(0, 4).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <div className="card-footer">
            <span>{formatDate(idea.updatedAt)}</span>
            <span>{todoSummary.total ? `${todoSummary.done}/${todoSummary.total} completed` : "No todos"}</span>
          </div>
          {todoSummary.total > 0 && (
            <div className="progress-track">
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
              </>
            );
          })()}
        </button>
      ))}
    </section>
  );
}

function IdeaDetail({
  idea,
  onEdit,
  onDelete,
  onAbandon,
  onPromote,
  onStatusChange,
  onSaveTodo,
  onChangeTodoStatus,
  onDeleteTodo,
  onMoveTodo,
  onDropTodo,
  dailyTodos,
  onImportDailyTodos,
  llmSettings,
  onOpenRepository,
  onCopyRepository,
  onRevealRepository,
}: {
  idea?: Idea;
  onEdit: (idea: Idea) => void;
  onDelete: (id: string) => void;
  onAbandon: (idea: Idea) => void;
  onPromote: (idea: Idea) => void;
  onStatusChange: (id: string, status: IdeaStatus) => void;
  onSaveTodo: (ideaId: string, todo: TodoItem) => void;
  onChangeTodoStatus: (ideaId: string, todoId: string, status: TodoStatus) => void;
  onDeleteTodo: (ideaId: string, todoId: string) => void;
  onMoveTodo: (ideaId: string, todoId: string, direction: -1 | 1) => void;
  onDropTodo: (ideaId: string, todoId: string, status: TodoStatus, overId?: string) => void;
  dailyTodos: DailyTodo[];
  onImportDailyTodos: (ideaId: string, todos: DailyTodo[], linked: boolean) => void;
  llmSettings: LlmSettings;
  onOpenRepository: (repo: RelatedRepository) => void;
  onCopyRepository: (repo: RelatedRepository) => void;
  onRevealRepository: (repo: RelatedRepository) => void;
}) {
  const t = useI18n();
  if (!idea) {
    return (
      <section className="detail-panel empty-detail">
        <FileText size={36} />
        <h2>选择一个 idea 查看详情</h2>
      </section>
    );
  }

  const todoSummary = todoCompletionSummary(idea.todos);
  const todoProgress = calculateTodoProgress(idea.todos);

  return (
    <section className="detail-panel">
      <div className="detail-heading">
        <div>
          <div className="card-topline">
            <StatusChip status={idea.status} />
            <PriorityChip priority={idea.priority} />
          </div>
          <h2>{idea.title}</h2>
          <p>
            创建 {formatDateOnly(idea.createdAt)} · 更新 {formatDate(idea.updatedAt)}
          </p>
        </div>
        <div className="detail-actions">
          <button className="ghost-button icon-button" title={idea.projectId ? `Project ${idea.projectId}` : "Create Project from Idea"} onClick={() => onPromote(idea)}>
            <Database size={18} />
          </button>
          <button className="ghost-button icon-button" title="编辑" onClick={() => onEdit(idea)}>
            <Pencil size={18} />
          </button>
          <button className="ghost-button icon-button" title="移入放弃" onClick={() => onAbandon(idea)}>
            <Archive size={18} />
          </button>
          <button className="danger-button icon-button" title="删除" onClick={() => onDelete(idea.id)}>
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      <div className="status-switcher">
        {statusOrder.map((status) => (
          <button key={status} className={idea.status === status ? "active" : ""} onClick={() => onStatusChange(idea.id, status)}>
            {statusMeta[status].shortLabel}
          </button>
        ))}
      </div>

      <div className="meta-strip">
        <span>
          <Database size={16} />
          {idea.externalIdeaId ?? "未镜像"}{idea.projectId ? ` -> ${idea.projectId}` : ""}
        </span>
        <span>
          <ListTodo size={16} />
          {todoSummary.total ? `${todoSummary.done}/${todoSummary.total} completed · ${todoProgress}%` : t("idea.no_todos")}
        </span>
        <span>
          <Tag size={16} />
          {idea.tags.length ? idea.tags.join(" / ") : t("idea.no_tags")}
        </span>
      </div>

      <section className="detail-section">
        <h3>{t("idea.content")}</h3>
        <pre>{idea.content}</pre>
      </section>

      <section className="detail-section">
        <h3>{t("idea.plan")}</h3>
        <pre>{idea.plan}</pre>
      </section>

      <ProjectTodoSection
        idea={idea}
        onSaveTodo={onSaveTodo}
        onChangeTodoStatus={onChangeTodoStatus}
        onDeleteTodo={onDeleteTodo}
        onMoveTodo={onMoveTodo}
        onDropTodo={onDropTodo}
        dailyTodos={dailyTodos}
        onImportDailyTodos={onImportDailyTodos}
        llmSettings={llmSettings}
      />

      <section className="detail-section">
        <div className="section-title compact">
          <h3>{t("repo.title")}</h3>
          <span>{idea.repositories.length}</span>
        </div>
        {idea.repositories.length === 0 ? (
          <p className="muted-text">{t("repo.empty")}</p>
        ) : (
          <div className="repo-list">
            {idea.repositories.map((repo) => (
              <div key={repo.id} className="repo-row">
                <FolderOpen size={18} />
                <div>
                  <strong>{repo.name || repo.urlOrPath}</strong>
                  <span>
                    {repositoryTypeLabels[repo.type]} · {repo.note || repo.urlOrPath}
                    {repo.extension ? ` · .${repo.extension}` : ""}
                  </span>
                </div>
                <button className="text-icon-button" title={t("common.open")} onClick={() => onOpenRepository(repo)}>
                  {/https?:\/\//i.test(repo.urlOrPath) ? <ExternalLink size={17} /> : <FolderOpen size={17} />}
                </button>
                <button className="text-icon-button" title={t("repo.copy")} onClick={() => onCopyRepository(repo)}>
                  <ClipboardCopy size={17} />
                </button>
                {!/^https?:\/\//i.test(repo.urlOrPath) && (
                  <button className="text-icon-button" title={t("repo.reveal")} onClick={() => onRevealRepository(repo)}>
                    <Eye size={17} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {idea.notes && (
        <section className="detail-section">
          <h3>{t("idea.notes")}</h3>
          <p>{idea.notes}</p>
        </section>
      )}
    </section>
  );
}

function ProjectTodoSection({
  idea,
  onSaveTodo,
  onChangeTodoStatus,
  onDeleteTodo,
  onMoveTodo,
  onDropTodo,
  dailyTodos,
  onImportDailyTodos,
  llmSettings,
}: {
  idea: Idea;
  onSaveTodo: (ideaId: string, todo: TodoItem) => void;
  onChangeTodoStatus: (ideaId: string, todoId: string, status: TodoStatus) => void;
  onDeleteTodo: (ideaId: string, todoId: string) => void;
  onMoveTodo: (ideaId: string, todoId: string, direction: -1 | 1) => void;
  onDropTodo: (ideaId: string, todoId: string, status: TodoStatus, overId?: string) => void;
  dailyTodos: DailyTodo[];
  onImportDailyTodos: (ideaId: string, todos: DailyTodo[], linked: boolean) => void;
  llmSettings: LlmSettings;
}) {
  const t = useI18n();
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [dailyImportOpen, setDailyImportOpen] = useState(false);
  const sensors = useAppDragSensors();
  const todos = [...(idea.todos ?? [])].sort((a, b) => a.order - b.order);
  const summary = todoCompletionSummary(todos);

  function handleTodoDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!overId || activeId === overId) return;

    const targetColumnStatus = todoStatusFromColumnId(overId, "project");
    if (targetColumnStatus) {
      onDropTodo(idea.id, activeId, targetColumnStatus);
      return;
    }

    const overTodo = todos.find((todo) => todo.id === overId);
    if (overTodo) onDropTodo(idea.id, activeId, overTodo.status, overTodo.id);
  }

  return (
    <section className="detail-section todo-section">
      <div className="section-title compact">
        <div>
          <h3>{t("projectTodo.title")}</h3>
          <span className="section-caption">{t("projectTodo.caption")}</span>
        </div>
        <div className="todo-section-actions">
          <span className="todo-progress-label">
            {summary.total ? t("projectTodo.completed", { done: summary.done, total: summary.total }) : t("projectTodo.completed", { done: 0, total: 0 })}
            {summary.cancelled ? ` · ${summary.cancelled} ${todoStatusMeta.cancelled.label}` : ""}
          </span>
          <button type="button" className="ghost-button ai-button" onClick={() => setAiModalOpen(true)}>
            <Sparkles size={16} />
            {t("projectTodo.ai")}
          </button>
          <button type="button" className="ghost-button" onClick={() => setDailyImportOpen(true)}>
            <ListTodo size={16} />
            {t("projectTodo.fromDaily")}
          </button>
          <button type="button" className="ghost-button" onClick={() => setEditingTodo(createBlankProjectTodo(todos.length))}>
            <Plus size={16} />
            {t("projectTodo.add")}
          </button>
        </div>
      </div>

      {summary.total > 0 && (
        <div className="progress-track todo-progress">
          <span style={{ width: `${calculateTodoProgress(todos)}%` }} />
        </div>
      )}

      {todos.length === 0 ? (
        <p className="muted-text">{t("projectTodo.empty")}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleTodoDragEnd}>
          <div className="todo-status-board project-todo-board">
            {todoStatusOrder.map((status) => {
              const groupTodos = todos.filter((todo) => todo.status === status).sort((a, b) => a.order - b.order);
              return (
                <DroppableColumn key={status} id={todoColumnId("project", status)} className="todo-drop-group">
                  <div className="daily-group-heading">
                    <strong>{todoStatusMeta[status].label}</strong>
                    <span>{groupTodos.length}</span>
                  </div>
                  <SortableContext items={groupTodos.map((todo) => todo.id)} strategy={verticalListSortingStrategy}>
                    <div className="todo-list">
                      {groupTodos.map((todo, index) => (
                        <TodoCard
                          key={todo.id}
                          todo={todo}
                          index={index}
                          total={groupTodos.length}
                          onEdit={() => setEditingTodo(todo)}
                          onStatusChange={(nextStatus) => onChangeTodoStatus(idea.id, todo.id, nextStatus)}
                          onDelete={() => onDeleteTodo(idea.id, todo.id)}
                          onMove={(direction) => onMoveTodo(idea.id, todo.id, direction)}
                        />
                      ))}
                      {groupTodos.length === 0 && <p className="muted-text daily-empty-group">{t("daily.emptyGroup")}</p>}
                    </div>
                  </SortableContext>
                </DroppableColumn>
              );
            })}
          </div>
        </DndContext>
      )}

      {editingTodo && (
        <ProjectTodoEditorModal
          todo={editingTodo}
          onClose={() => setEditingTodo(null)}
          onSave={(todo) => {
            onSaveTodo(idea.id, todo);
            setEditingTodo(null);
          }}
        />
      )}

      {aiModalOpen && (
        <ProjectTodoAiModal
          idea={idea}
          llmSettings={llmSettings}
          onClose={() => setAiModalOpen(false)}
          onApply={(drafts) => {
            drafts.forEach((draft, index) => {
              onSaveTodo(idea.id, {
                ...createBlankProjectTodo(todos.length + index),
                title: draft.title,
                description: draft.description,
                status: draft.status ?? "todo",
                priority: draft.priority ?? "medium",
                dueDate: draft.dueDate || undefined,
                tags: draft.tags ?? [],
              });
            });
            setAiModalOpen(false);
          }}
        />
      )}

      {dailyImportOpen && (
        <DailyTodoImportModal
          todos={dailyTodos}
          onClose={() => setDailyImportOpen(false)}
          onApply={(selectedTodos, linked) => {
            onImportDailyTodos(idea.id, selectedTodos, linked);
            setDailyImportOpen(false);
          }}
        />
      )}
    </section>
  );
}

function TodoCard({
  todo,
  index,
  total,
  onEdit,
  onStatusChange,
  onDelete,
  onMove,
}: {
  todo: TodoItem;
  index: number;
  total: number;
  onEdit: () => void;
  onStatusChange: (status: TodoStatus) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const t = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });
  return (
    <article
      ref={setNodeRef}
      className={`todo-card sortable-card ${todoStatusMeta[todo.status].className}${isDragging ? " dragging" : ""}`}
      style={sortableStyle(CSS.Transform.toString(transform), transition, isDragging)}
      {...attributes}
      {...listeners}
    >
      <div className="todo-card-main">
        <div className="todo-title-row">
          <strong>{todo.title}</strong>
          <PriorityChip priority={todo.priority} />
        </div>
        {todo.description && <p>{todo.description}</p>}
        {todo.tags && todo.tags.length > 0 && (
          <div className="tag-row">
            {todo.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        <div className="todo-meta-row">
          {todo.dueDate && (
            <span>
              <Calendar size={14} />
              {formatDateOnly(todo.dueDate)}
            </span>
          )}
          {todo.completedAt && (
            <span>
              <Check size={14} />
              {formatDate(todo.completedAt)}
            </span>
          )}
          {todo.link?.type === "daily_todo" && (
            <span>
              <Link2 size={14} />
              {t("todo.linkedDaily")} · {formatDateOnly(todo.link.dailyTodoDate)}
            </span>
          )}
        </div>
      </div>
      <div className="todo-card-controls">
        <select value={todo.status} onChange={(event) => onStatusChange(event.target.value as TodoStatus)}>
          {todoStatusOrder.map((status) => (
            <option key={status} value={status}>
              {todoStatusMeta[status].label}
            </option>
          ))}
        </select>
        <button type="button" className="text-icon-button" title="上移" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp size={16} />
        </button>
        <button type="button" className="text-icon-button" title="下移" disabled={index === total - 1} onClick={() => onMove(1)}>
          <ArrowDown size={16} />
        </button>
        <button type="button" className="text-icon-button" title="编辑" onClick={onEdit}>
          <Pencil size={16} />
        </button>
        <button type="button" className="text-icon-button danger-inline" title="删除" onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function ProjectTodoEditorModal({
  todo,
  onClose,
  onSave,
}: {
  todo: TodoItem;
  onClose: () => void;
  onSave: (todo: TodoItem) => void;
}) {
  const [draft, setDraft] = useState<TodoItem>(todo);

  function patch<K extends keyof TodoItem>(key: K, value: TodoItem[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(draft);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="task-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Project Todo</p>
            <h2>{todo.title ? "编辑 Todo" : "新增 Todo"}</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <TodoFormFields draft={draft} onPatch={patch} />
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button">
            <Check size={18} />
            保存 Todo
          </button>
        </div>
      </form>
    </div>
  );
}

function ProjectTodoAiModal({
  idea,
  llmSettings,
  onClose,
  onApply,
}: {
  idea: Idea;
  llmSettings: LlmSettings;
  onClose: () => void;
  onApply: (todos: TodoDraft[]) => void;
}) {
  const t = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<TodoDraft[]>([]);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      setDrafts(await generateProjectTodosWithAI(idea, llmSettings));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : String(currentError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="task-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Project Todo AI</p>
            <h2>{t("projectTodo.aiTitle")}</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="muted-text">{t("projectTodo.aiBody")}</p>
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-actions split">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary-button" onClick={generate} disabled={loading}>
            <Sparkles size={18} />
            {loading ? t("common.loading") : t("projectTodo.aiGenerate")}
          </button>
        </div>
        {drafts.length > 0 && (
          <AiTodoPreview
            drafts={drafts}
            onPatch={setDrafts}
            onApply={() => onApply(drafts)}
            applyLabel={t("projectTodo.applyPreview")}
          />
        )}
      </section>
    </div>
  );
}

function DailyTodoImportModal({
  todos,
  onClose,
  onApply,
}: {
  todos: DailyTodo[];
  onClose: () => void;
  onApply: (todos: DailyTodo[], linked: boolean) => void;
}) {
  const t = useI18n();
  const [date, setDate] = useState(todayDateKey());
  const [query, setQuery] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [linked, setLinked] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const visibleTodos = todos
    .filter((todo) => todo.date === date)
    .filter((todo) => (onlyOpen ? todo.status !== "done" && todo.status !== "cancelled" : true))
    .filter((todo) => matchesDailyTodo(todo, query, "all"))
    .sort((a, b) => a.order - b.order);

  function toggle(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="task-modal import-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Daily Todo</p>
            <h2>{t("daily.fromTitle")}</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="import-toolbar">
          <label className="field">
            <span>{t("common.date")}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("common.search")} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} />
            {t("daily.showOpen")}
          </label>
        </div>
        <div className="import-list">
          {visibleTodos.map((todo) => (
            <label key={todo.id} className="import-row">
              <input type="checkbox" checked={selectedIds.includes(todo.id)} onChange={() => toggle(todo.id)} />
              <span>
                <strong>{todo.title}</strong>
                <small>
                  {todoStatusMeta[todo.status].label} · {priorityMeta[todo.priority].label}
                </small>
              </span>
            </label>
          ))}
          {visibleTodos.length === 0 && <p className="muted-text">{t("daily.emptyGroup")}</p>}
        </div>
        <div className="import-mode">
          <span>{t("daily.importMode")}</span>
          <label>
            <input type="radio" checked={!linked} onChange={() => setLinked(false)} />
            {t("daily.copyOnly")}
          </label>
          <label>
            <input type="radio" checked={linked} onChange={() => setLinked(true)} />
            {t("daily.linkWithDaily")}
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onApply(todos.filter((todo) => selectedIds.includes(todo.id)), linked)}
            disabled={selectedIds.length === 0}
          >
            <Check size={18} />
            {t("common.confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}

function IdeasBoard({
  ideas,
  onSelect,
  onEdit,
  onMoveIdea,
}: {
  ideas: Idea[];
  onSelect: (idea: Idea) => void;
  onEdit: (idea: Idea) => void;
  onMoveIdea: (id: string, status: IdeaStatus, overId?: string) => void;
}) {
  const t = useI18n();
  const sensors = useAppDragSensors();

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!overId || activeId === overId) return;

    const targetColumnStatus = ideaStatusFromColumnId(overId);
    if (targetColumnStatus) {
      onMoveIdea(activeId, targetColumnStatus);
      return;
    }

    const overIdea = ideas.find((idea) => idea.id === overId);
    if (overIdea) onMoveIdea(activeId, overIdea.status, overIdea.id);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <section className="board">
        {statusOrder.map((status) => {
          const columnIdeas = ideas.filter((idea) => idea.status === status).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const Icon = statusMeta[status].icon;
          return (
            <DroppableColumn key={status} id={ideaColumnId(status)} className="board-column">
              <div className="board-heading">
                <Icon size={18} />
                <strong>{statusMeta[status].shortLabel}</strong>
                <span>{columnIdeas.length}</span>
              </div>
              <SortableContext items={columnIdeas.map((idea) => idea.id)} strategy={verticalListSortingStrategy}>
                <div className="board-stack">
                  {columnIdeas.map((idea) => (
                    <SortableIdeaCard key={idea.id} idea={idea} onSelect={onSelect} onEdit={onEdit} />
                  ))}
                  {columnIdeas.length === 0 && <div className="board-empty">{t("board.dropHere")}</div>}
                </div>
              </SortableContext>
            </DroppableColumn>
          );
        })}
      </section>
    </DndContext>
  );
}

function SortableIdeaCard({ idea, onSelect, onEdit }: { idea: Idea; onSelect: (idea: Idea) => void; onEdit: (idea: Idea) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idea.id });
  const summary = todoCompletionSummary(idea.todos);

  return (
    <article
      ref={setNodeRef}
      className={`board-card sortable-card${isDragging ? " dragging" : ""}`}
      style={sortableStyle(CSS.Transform.toString(transform), transition, isDragging)}
      onClick={() => onSelect(idea)}
      {...attributes}
      {...listeners}
    >
      <div className="card-topline">
        <PriorityChip priority={idea.priority} />
        <button
          type="button"
          className="text-icon-button"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(idea);
          }}
        >
          <Pencil size={15} />
        </button>
      </div>
      <h3>{idea.title}</h3>
      <p>{summarizeMarkdown(idea.content, 92)}</p>
      <div className="tag-row">
        {idea.tags.slice(0, 3).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="board-todo-summary">
        <ListTodo size={14} />
        <span>{summary.total ? `${summary.done}/${summary.total} completed` : "No todos"}</span>
      </div>
    </article>
  );
}

function DailyTodoPage({
  todos,
  selectedDate,
  allTags,
  onDateChange,
  onNewTodo,
  onEditTodo,
  onStatusChange,
  onDeleteTodo,
  onMoveTodo,
  onDropTodo,
  onClearDone,
  onAddAiTodos,
  llmSettings,
}: {
  todos: DailyTodo[];
  selectedDate: string;
  allTags: string[];
  onDateChange: (date: string) => void;
  onNewTodo: () => void;
  onEditTodo: (todo: DailyTodo) => void;
  onStatusChange: (id: string, status: DailyTodoStatus) => void;
  onDeleteTodo: (id: string) => void;
  onMoveTodo: (id: string, direction: -1 | 1) => void;
  onDropTodo: (id: string, status: DailyTodoStatus, overId?: string) => void;
  onClearDone: (date: string) => void;
  onAddAiTodos: (drafts: TodoDraft[]) => void;
  llmSettings: LlmSettings;
}) {
  const t = useI18n();
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const sensors = useAppDragSensors();
  const dateTodos = todos.filter((todo) => todo.date === selectedDate);
  const visibleTodos = dateTodos.filter((todo) => matchesDailyTodo(todo, query, tagFilter)).sort((a, b) => a.order - b.order);
  const activeTodos = dateTodos.filter((todo) => todo.status !== "cancelled");
  const doneCount = activeTodos.filter((todo) => todo.status === "done").length;
  const inProgressCount = dateTodos.filter((todo) => todo.status === "in_progress").length;
  const todoCount = dateTodos.filter((todo) => todo.status === "todo").length;
  const completionRate = activeTodos.length ? Math.round((doneCount / activeTodos.length) * 100) : 0;

  function handleTodoDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!overId || activeId === overId) return;

    const targetColumnStatus = todoStatusFromColumnId(overId, "daily");
    if (targetColumnStatus) {
      onDropTodo(activeId, targetColumnStatus);
      return;
    }

    const overTodo = visibleTodos.find((todo) => todo.id === overId);
    if (overTodo) onDropTodo(activeId, overTodo.status, overTodo.id);
  }

  return (
    <section className="daily-page">
      <div className="daily-toolbar">
        <label className="field daily-date-field">
          <span>{t("common.date")}</span>
          <input type="date" value={selectedDate} onChange={(event) => onDateChange(event.target.value)} />
        </label>
        <button type="button" className="ghost-button" onClick={() => onDateChange(todayDateKey())}>
          <CalendarDays size={18} />
          {t("common.today")}
        </button>
        <label className="search-box daily-search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("common.search")} />
        </label>
        <select className="tag-select" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
          <option value="all">{t("common.all")}</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <button type="button" className="ghost-button" onClick={() => onClearDone(selectedDate)} disabled={!dateTodos.some((todo) => todo.status === "done")}>
          <Trash2 size={18} />
          {t("daily.clearDone")}
        </button>
        <button type="button" className="ghost-button ai-button" onClick={() => setAiModalOpen(true)}>
          <Sparkles size={18} />
          {t("daily.ai")}
        </button>
        <button type="button" className="primary-button" onClick={onNewTodo}>
          <Plus size={18} />
          {t("daily.new")}
        </button>
      </div>

      <div className="daily-layout">
        <aside className="daily-stats-panel">
          <div>
            <span>{t("daily.total")}</span>
            <strong>{dateTodos.length}</strong>
          </div>
          <div>
            <span>{t("daily.done")}</span>
            <strong>{doneCount}</strong>
          </div>
          <div>
            <span>{t("daily.inProgress")}</span>
            <strong>{inProgressCount}</strong>
          </div>
          <div>
            <span>{t("daily.notStarted")}</span>
            <strong>{todoCount}</strong>
          </div>
          <div className="daily-rate">
            <span>{t("daily.rate")}</span>
            <strong>{completionRate}%</strong>
            <div className="progress-track">
              <span style={{ width: `${completionRate}%` }} />
            </div>
          </div>
        </aside>

        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleTodoDragEnd}>
          <div className="daily-groups">
            {todoStatusOrder.map((status) => {
              const groupTodos = visibleTodos.filter((todo) => todo.status === status).sort((a, b) => a.order - b.order);
              return (
                <DroppableColumn key={status} id={todoColumnId("daily", status)} className="daily-group">
                  <div className="daily-group-heading">
                    <strong>{todoStatusMeta[status].label}</strong>
                    <span>{groupTodos.length}</span>
                  </div>
                  <SortableContext items={groupTodos.map((todo) => todo.id)} strategy={verticalListSortingStrategy}>
                    <div className="todo-list">
                      {groupTodos.map((todo) => {
                        const sameDateTodos = visibleTodos.filter((item) => item.date === todo.date).sort((a, b) => a.order - b.order);
                        const index = sameDateTodos.findIndex((item) => item.id === todo.id);
                        return (
                          <DailyTodoCard
                            key={todo.id}
                            todo={todo}
                            index={index}
                            total={sameDateTodos.length}
                            onEdit={() => onEditTodo(todo)}
                            onStatusChange={(nextStatus) => onStatusChange(todo.id, nextStatus)}
                            onDelete={() => onDeleteTodo(todo.id)}
                            onMove={(direction) => onMoveTodo(todo.id, direction)}
                          />
                        );
                      })}
                      {groupTodos.length === 0 && <p className="muted-text daily-empty-group">{t("daily.emptyGroup")}</p>}
                    </div>
                  </SortableContext>
                </DroppableColumn>
              );
            })}
          </div>
        </DndContext>
      </div>
      {aiModalOpen && (
        <DailyTodoAiModal
          selectedDate={selectedDate}
          llmSettings={llmSettings}
          onClose={() => setAiModalOpen(false)}
          onApply={(drafts) => {
            onAddAiTodos(drafts);
            setAiModalOpen(false);
          }}
        />
      )}
    </section>
  );
}

function DailyTodoCard({
  todo,
  index,
  total,
  onEdit,
  onStatusChange,
  onDelete,
  onMove,
}: {
  todo: DailyTodo;
  index: number;
  total: number;
  onEdit: () => void;
  onStatusChange: (status: DailyTodoStatus) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const t = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });
  return (
    <article
      ref={setNodeRef}
      className={`todo-card daily-todo-card sortable-card ${todoStatusMeta[todo.status].className}${isDragging ? " dragging" : ""}`}
      style={sortableStyle(CSS.Transform.toString(transform), transition, isDragging)}
      {...attributes}
      {...listeners}
    >
      <div className="todo-card-main">
        <div className="todo-title-row">
          <strong>{todo.title}</strong>
          <PriorityChip priority={todo.priority} />
        </div>
        {todo.description && <p>{todo.description}</p>}
        <div className="tag-row">
          {todo.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <div className="todo-meta-row">
          <span>
            <Calendar size={14} />
            {formatDateOnly(todo.date)}
          </span>
          {todo.completedAt && (
            <span>
              <Check size={14} />
              {formatDate(todo.completedAt)}
            </span>
          )}
          {normalizeLinkedProjectTodos(todo.linkedProjectTodos).length > 0 && (
            <span>
              <Link2 size={14} />
              {t("todo.linkedProject")}
            </span>
          )}
        </div>
      </div>
      <div className="todo-card-controls">
        <select value={todo.status} onChange={(event) => onStatusChange(event.target.value as DailyTodoStatus)}>
          {todoStatusOrder.map((status) => (
            <option key={status} value={status}>
              {todoStatusMeta[status].label}
            </option>
          ))}
        </select>
        <button type="button" className="text-icon-button" title="恢复为待办" onClick={() => onStatusChange("todo")}>
          <RotateCcw size={16} />
        </button>
        <button type="button" className="text-icon-button" title="完成" onClick={() => onStatusChange("done")}>
          <Check size={16} />
        </button>
        <button type="button" className="text-icon-button" title="上移" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp size={16} />
        </button>
        <button type="button" className="text-icon-button" title="下移" disabled={index === total - 1} onClick={() => onMove(1)}>
          <ArrowDown size={16} />
        </button>
        <button type="button" className="text-icon-button" title="编辑" onClick={onEdit}>
          <Pencil size={16} />
        </button>
        <button type="button" className="text-icon-button danger-inline" title="删除" onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function DailyTodoAiModal({
  selectedDate,
  llmSettings,
  onClose,
  onApply,
}: {
  selectedDate: string;
  llmSettings: LlmSettings;
  onClose: () => void;
  onApply: (todos: TodoDraft[]) => void;
}) {
  const t = useI18n();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<TodoDraft[]>([]);

  async function generate() {
    if (!input.trim()) {
      setError(t("error.aiInput"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      setDrafts(await generateDailyTodosWithAI(input, selectedDate, llmSettings));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : String(currentError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="task-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Daily Todo AI</p>
            <h2>{t("daily.aiTitle")}</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field wide ai-input">
          <span>{t("common.description")}</span>
          <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={5} placeholder={t("daily.aiPlaceholder")} autoFocus />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-actions split">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary-button" onClick={generate} disabled={loading}>
            <Sparkles size={18} />
            {loading ? t("common.loading") : t("daily.aiGenerate")}
          </button>
        </div>
        {drafts.length > 0 && (
          <AiTodoPreview drafts={drafts} onPatch={setDrafts} onApply={() => onApply(drafts)} applyLabel={t("daily.applyPreview")} />
        )}
      </section>
    </div>
  );
}

function AiTodoPreview({
  drafts,
  onPatch,
  onApply,
  applyLabel,
}: {
  drafts: TodoDraft[];
  onPatch: (todos: TodoDraft[]) => void;
  onApply: () => void;
  applyLabel: string;
}) {
  const t = useI18n();

  function patchTodo(index: number, patch: Partial<TodoDraft>) {
    onPatch(drafts.map((todo, todoIndex) => (todoIndex === index ? { ...todo, ...patch } : todo)));
  }

  function removeTodo(index: number) {
    onPatch(drafts.filter((_todo, todoIndex) => todoIndex !== index));
  }

  return (
    <section className="ai-preview todo-ai-preview">
      <div className="section-title compact">
        <h3>{t("common.preview")}</h3>
        <button type="button" className="primary-button" onClick={onApply} disabled={drafts.length === 0}>
          <Plus size={16} />
          {applyLabel}
        </button>
      </div>
      <div className="todo-preview-list">
        {drafts.map((todo, index) => (
          <div key={`${todo.title}-${index}`} className="todo-preview-row">
            <input value={todo.title} onChange={(event) => patchTodo(index, { title: event.target.value })} placeholder={t("common.title")} />
            <select value={todo.priority ?? "medium"} onChange={(event) => patchTodo(index, { priority: event.target.value as Priority })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <select value={todo.status ?? "todo"} onChange={(event) => patchTodo(index, { status: event.target.value as TodoStatus })}>
              {todoStatusOrder.map((status) => (
                <option key={status} value={status}>
                  {todoStatusMeta[status].label}
                </option>
              ))}
            </select>
            <input value={todo.tags?.join(", ") ?? ""} onChange={(event) => patchTodo(index, { tags: normalizeTags(event.target.value) })} placeholder="tags" />
            <textarea value={todo.description ?? ""} onChange={(event) => patchTodo(index, { description: event.target.value })} placeholder={t("common.description")} rows={2} />
            <button type="button" className="danger-button icon-button" onClick={() => removeTodo(index)}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPage({
  settings,
  ideaCount,
  onSettingsChange,
  onExport,
  onImport,
}: {
  settings: AppSettings;
  ideaCount: number;
  onSettingsChange: (settings: AppSettings) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const t = useI18n();
  const { theme, llm } = settings;
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>(() => defaultModelOptions(llm.provider));
  const [modelListMessage, setModelListMessage] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const updateTheme = (nextTheme: ThemeMode) => onSettingsChange({ ...settings, theme: nextTheme });
  const updateLanguage = (language: AppSettings["language"]) => onSettingsChange({ ...settings, language });
  const updateLlm = (patch: Partial<LlmSettings>) => onSettingsChange({ ...settings, llm: { ...llm, ...patch } });

  useEffect(() => {
    setModelOptions(defaultModelOptions(llm.provider));
    setModelListMessage("");
    setTestResult(null);
  }, [llm.provider]);

  function changeProvider(provider: LlmSettings["provider"]) {
    onSettingsChange({
      ...settings,
      llm: {
        ...llm,
        provider,
        baseUrl: providerBaseUrls[provider],
        model: providerDefaultModels[provider],
      },
    });
  }

  async function refreshModels() {
    setModelListMessage("");
    setTestResult(null);
    if (llm.provider === "anthropic") {
      setModelOptions(anthropicModelPresets);
      setModelListMessage("Anthropic 使用常见模型预设，也支持手动输入模型名。");
      if (!llm.model.trim()) updateLlm({ model: anthropicModelPresets[0] });
      return;
    }

    const validation = validateLlmSettings(llm, { requireModel: false });
    if (validation) {
      setModelListMessage(validation);
      return;
    }

    setModelsLoading(true);
    try {
      const models = await fetchLlmModels(llm);
      setModelOptions(models);
      setModelListMessage(`已刷新 ${models.length} 个模型。`);
      if (!llm.model.trim() && models[0]) updateLlm({ model: models[0] });
    } catch (error) {
      setModelListMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setModelsLoading(false);
    }
  }

  async function testConnection() {
    const validation = validateLlmSettings(llm, { requireModel: true });
    if (validation) {
      setTestResult({
        ok: false,
        provider: llm.provider,
        baseUrl: llm.baseUrl,
        model: llm.model,
        message: validation,
      });
      return;
    }

    setTestLoading(true);
    setTestResult(null);
    try {
      setTestResult(await testLlmConnection(llm));
    } catch (error) {
      setTestResult({
        ok: false,
        provider: llm.provider,
        baseUrl: llm.baseUrl,
        model: llm.model,
        message: "连接测试失败。",
        rawError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <section className="settings-page">
      <div className="settings-card">
        <Database size={22} />
        <div>
          <h2>{t("settings.localData")}</h2>
          <p>{t("settings.localDataBody", { count: ideaCount })}</p>
        </div>
        <div className="settings-actions">
          <button className="ghost-button" onClick={onImport}>
            <Upload size={18} />
            {t("settings.import")}
          </button>
          <button className="primary-button" onClick={onExport}>
            <Download size={18} />
            {t("settings.export")}
          </button>
        </div>
      </div>

      <div className="settings-card">
        {theme === "dark" ? <Moon size={22} /> : <Sun size={22} />}
        <div>
          <h2>{t("settings.theme")}</h2>
          <p>{t("settings.themeBody")}</p>
        </div>
        <div className="segmented">
          <button className={theme === "light" ? "active" : ""} onClick={() => updateTheme("light")}>
            {t("settings.light")}
          </button>
          <button className={theme === "dark" ? "active" : ""} onClick={() => updateTheme("dark")}>
            {t("settings.dark")}
          </button>
        </div>
      </div>

      <div className="settings-card">
        <Languages size={22} />
        <div>
          <h2>{t("settings.language")}</h2>
          <p>{t("settings.languageBody")}</p>
        </div>
        <div className="segmented">
          <button className={settings.language === "en" ? "active" : ""} onClick={() => updateLanguage("en")}>
            {t("settings.english")}
          </button>
          <button className={settings.language === "zh" ? "active" : ""} onClick={() => updateLanguage("zh")}>
            {t("settings.chinese")}
          </button>
        </div>
      </div>

      <div className="settings-card settings-form-card">
        <Sparkles size={22} />
        <div>
          <h2>{t("settings.llm")}</h2>
          <p>{t("settings.llmBody")}</p>
          <div className="settings-form-grid">
            <label className="field">
              <span>Provider</span>
              <select value={llm.provider} onChange={(event) => changeProvider(event.target.value as LlmSettings["provider"])}>
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>
            <label className="field">
              <span>Model</span>
              <input
                list="model-options"
                value={llm.model}
                onChange={(event) => updateLlm({ model: event.target.value })}
                placeholder="gpt-4.1-mini"
              />
              <datalist id="model-options">
                {modelOptions.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
            <label className="field wide">
              <span>Base URL</span>
              <input
                value={llm.baseUrl}
                onChange={(event) => updateLlm({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="field wide">
              <span>API Key</span>
              <div className="secret-input">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={llm.apiKey}
                  onChange={(event) => updateLlm({ apiKey: event.target.value })}
                  placeholder="API Key"
                  autoComplete="off"
                />
                <button type="button" className="text-icon-button" title={showApiKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowApiKey((value) => !value)}>
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          </div>
          {llm.provider === "openai-compatible" && (
            <p className="settings-note">DeepSeek、本地模型服务和第三方 OpenAI-compatible API 都可使用该模式。</p>
          )}
          {!llm.apiKey.trim() && <p className="settings-warning">未配置 API Key 时，AI 新建和 AI 修改会显示配置提示。</p>}
          <div className="settings-actions llm-actions">
            <button className="ghost-button" onClick={refreshModels} disabled={modelsLoading}>
              <RefreshCw size={18} />
              {modelsLoading ? t("common.loading") : t("settings.refreshModels")}
            </button>
            <button className="primary-button" onClick={testConnection} disabled={testLoading}>
              <Sparkles size={18} />
              {testLoading ? t("common.loading") : t("settings.testConnection")}
            </button>
          </div>
          {modelListMessage && <p className="settings-note">{modelListMessage}</p>}
          {testResult && (
            <div className={`connection-result ${testResult.ok ? "success" : "failure"}`}>
              <strong>{testResult.ok ? "连接成功，模型可用。" : testResult.message}</strong>
              <span>
                {testResult.provider} · {testResult.baseUrl} · {testResult.model || "未选择模型"}
              </span>
              {!testResult.ok && testResult.statusCode && <span>Status: {testResult.statusCode}</span>}
              {!testResult.ok && testResult.rawError && <pre>{testResult.rawError}</pre>}
            </div>
          )}
        </div>
      </div>

      <div className="settings-card">
        <Sparkles size={22} />
        <div>
          <h2>{t("settings.about")}</h2>
          <p>{t("settings.aboutBody")}</p>
        </div>
      </div>
    </section>
  );
}

function AIIdeaModal({
  llmSettings,
  onClose,
  onInsert,
}: {
  llmSettings: LlmSettings;
  onClose: () => void;
  onInsert: (draft: IdeaDraft) => void;
}) {
  const [input, setInput] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState<IdeaDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!input.trim()) {
      setError("请输入科研 idea 描述后再生成。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      setGeneratedDraft(await generateIdeaWithAI(input, llmSettings));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : String(currentError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="idea-modal ai-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">AI idea composer</p>
            <h2>AI 新建 Idea</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <label className="field wide ai-input">
          <span>Natural Language Description</span>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={6}
            placeholder="例如：研究转轮除湿系统中传感器噪声对模型辨识的影响，可能用 UKF 或粒子滤波做数据同化。"
            autoFocus
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <div className="modal-actions split">
          <button type="button" className="ghost-button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary-button" onClick={generate} disabled={loading}>
            <Sparkles size={18} />
            {loading ? "生成中..." : generatedDraft ? "重新生成" : "生成结构化 Idea"}
          </button>
        </div>

        {generatedDraft && (
          <section className="ai-preview">
            <div className="section-title compact">
              <h3>生成结果预览</h3>
              <button type="button" className="primary-button" onClick={() => onInsert(generatedDraft)}>
                <Plus size={16} />
                插入到新建 Idea 表单
              </button>
            </div>
            <IdeaDraftPreview draft={generatedDraft} />
          </section>
        )}
      </section>
    </div>
  );
}

function IdeaEditorModal({
  idea,
  llmSettings,
  onClose,
  onSave,
}: {
  idea: Idea;
  llmSettings: LlmSettings;
  onClose: () => void;
  onSave: (idea: Idea) => void;
}) {
  const t = useI18n();
  const [draft, setDraft] = useState<Idea>(idea);
  const [tagsInput, setTagsInput] = useState(idea.tags.join(", "));
  const [modifyModalOpen, setModifyModalOpen] = useState(false);

  function patch<K extends keyof Idea>(key: K, value: Idea[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function patchRepository(id: string, patchValue: Partial<RelatedRepository>) {
    setDraft((current) => ({
      ...current,
      repositories: current.repositories.map((repo) => (repo.id === id ? { ...repo, ...patchValue } : repo)),
    }));
  }

  async function addLocalFolder() {
    const selected = normalizeDialogPath(await openDialog({ directory: true, multiple: false }));
    if (!selected) return;
    patch("repositories", [
      ...draft.repositories,
      {
        id: createId("repo"),
        name: pathName(selected),
        type: "local_folder",
        urlOrPath: selected,
        note: "Local Folder",
        indexedAt: new Date().toISOString(),
      },
    ]);
  }

  async function addLocalFile() {
    const selected = normalizeDialogPath(await openDialog({ directory: false, multiple: false }));
    if (!selected) return;
    const extension = pathExtension(selected);
    patch("repositories", [
      ...draft.repositories,
      {
        id: createId("repo"),
        name: pathName(selected),
        type: repositoryTypeFromFile(selected),
        urlOrPath: selected,
        note: "Local File",
        indexedAt: new Date().toISOString(),
        extension,
      },
    ]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ ...draft, tags: normalizeTags(tagsInput) });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="idea-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Idea editor</p>
            <h2>{idea.title ? "编辑科研 idea" : "新建科研 idea"}</h2>
          </div>
          <div className="modal-heading-actions">
            <button type="button" className="ghost-button ai-button" onClick={() => setModifyModalOpen(true)}>
              <Sparkles size={18} />
              {t("idea.ai_modify")}
            </button>
            <button type="button" className="ghost-button icon-button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="form-grid">
          <label className="field wide">
            <span>Title</span>
            <input value={draft.title} onChange={(event) => patch("title", event.target.value)} placeholder="简短描述科研想法" autoFocus />
          </label>

          <label className="field">
            <span>Status</span>
            <select value={draft.status} onChange={(event) => patch("status", event.target.value as IdeaStatus)}>
              {statusOrder.map((status) => (
                <option key={status} value={status}>
                  {statusMeta[status].shortLabel}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Priority</span>
            <select value={draft.priority} onChange={(event) => patch("priority", event.target.value as Priority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <label className="field wide">
            <span>Tags</span>
            <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="MLP, CFD, 论文想法" />
          </label>

          <label className="field wide">
            <span>Content</span>
            <textarea value={draft.content} onChange={(event) => patch("content", event.target.value)} rows={9} />
          </label>

          <label className="field wide">
            <span>Plan / Research Route</span>
            <textarea value={draft.plan} onChange={(event) => patch("plan", event.target.value)} rows={7} />
          </label>

          <label className="field wide">
            <span>Notes</span>
            <textarea value={draft.notes ?? ""} onChange={(event) => patch("notes", event.target.value)} rows={3} />
          </label>
        </div>

        <section className="repo-editor">
          <div className="section-title compact">
            <h3>Related Document Repository</h3>
            <div className="repo-editor-actions">
              <button type="button" className="ghost-button" onClick={addLocalFolder}>
                <FolderOpen size={16} />
                选择文件夹
              </button>
              <button type="button" className="ghost-button" onClick={addLocalFile}>
                <FileText size={16} />
                选择文件
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => patch("repositories", [...draft.repositories, blankRepository()])}
              >
                <Plus size={16} />
                添加 URL
              </button>
            </div>
          </div>

          {draft.repositories.map((repo) => (
            <div key={repo.id} className="repo-edit-row">
              <input value={repo.name} onChange={(event) => patchRepository(repo.id, { name: event.target.value })} placeholder="名称" />
              <select value={repo.type} onChange={(event) => patchRepository(repo.id, { type: event.target.value as RepositoryType })}>
                {Object.entries(repositoryTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input value={repo.urlOrPath} onChange={(event) => patchRepository(repo.id, { urlOrPath: event.target.value })} placeholder="URL 或本地路径" />
              <input value={repo.note ?? ""} onChange={(event) => patchRepository(repo.id, { note: event.target.value })} placeholder="备注" />
              <input value={repo.extension ?? ""} onChange={(event) => patchRepository(repo.id, { extension: event.target.value })} placeholder="扩展名" />
              <button
                type="button"
                className="danger-button icon-button"
                onClick={() => patch("repositories", draft.repositories.filter((item) => item.id !== repo.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </section>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button">
            <Check size={18} />
            保存 Idea
          </button>
        </div>
      </form>
      {modifyModalOpen && (
        <IdeaModifyAiModal
          idea={ideaToDraft({ ...draft, tags: normalizeTags(tagsInput) })}
          llmSettings={llmSettings}
          onClose={() => setModifyModalOpen(false)}
          onApply={(modifiedDraft) => {
            setDraft(draftToIdea(modifiedDraft, draft));
            setTagsInput(modifiedDraft.tags.join(", "));
            setModifyModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function IdeaModifyAiModal({
  idea,
  llmSettings,
  onClose,
  onApply,
}: {
  idea: IdeaDraft;
  llmSettings: LlmSettings;
  onClose: () => void;
  onApply: (draft: IdeaDraft) => void;
}) {
  const t = useI18n();
  const [instruction, setInstruction] = useState("");
  const [modifiedDraft, setModifiedDraft] = useState<IdeaDraft | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function patch<K extends keyof IdeaDraft>(key: K, value: IdeaDraft[K]) {
    setModifiedDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function patchTodo(index: number, patchValue: Partial<TodoDraft>) {
    setModifiedDraft((current) =>
      current ? { ...current, todos: current.todos.map((todo, todoIndex) => (todoIndex === index ? { ...todo, ...patchValue } : todo)) } : current,
    );
  }

  function removeTodo(index: number) {
    setModifiedDraft((current) => (current ? { ...current, todos: current.todos.filter((_todo, todoIndex) => todoIndex !== index) } : current));
  }

  async function generate() {
    if (!instruction.trim()) {
      setError(t("idea.aiModifyInputError"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await modifyIdeaWithAI(idea, instruction, llmSettings);
      setModifiedDraft(result);
      setTagsInput(result.tags.join(", "));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : String(currentError));
    } finally {
      setLoading(false);
    }
  }

  function applyModifiedDraft() {
    if (!modifiedDraft) return;
    onApply({ ...modifiedDraft, tags: normalizeTags(tagsInput) });
  }

  return (
    <div className="modal-backdrop nested-modal" role="dialog" aria-modal="true">
      <section className="idea-modal ai-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">AI idea modifier</p>
            <h2>{t("idea.aiModifyTitle")}</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="modal-note">{t("idea.aiModifyBody")}</p>

        <label className="field wide ai-input">
          <span>{t("idea.aiModifyRequest")}</span>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={5}
            placeholder={t("idea.aiModifyPlaceholder")}
            autoFocus
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <div className="modal-actions split">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary-button" onClick={generate} disabled={loading}>
            <Sparkles size={18} />
            {loading ? t("idea.aiModifyLoading") : modifiedDraft ? t("idea.aiModifyRegenerate") : t("idea.aiModifyGenerate")}
          </button>
        </div>

        {modifiedDraft && (
          <section className="ai-preview">
            <div className="section-title compact">
              <div>
                <h3>{t("common.preview")}</h3>
                <span className="section-caption">{t("idea.aiModifyPreviewNote")}</span>
              </div>
              <button type="button" className="primary-button" onClick={applyModifiedDraft}>
                <Check size={16} />
                {t("idea.aiModifyApply")}
              </button>
            </div>

            <div className="form-grid ai-draft-edit-grid">
              <label className="field wide">
                <span>{t("common.title")}</span>
                <input value={modifiedDraft.title} onChange={(event) => patch("title", event.target.value)} />
              </label>
              <label className="field">
                <span>{t("common.status")}</span>
                <select value={modifiedDraft.status} onChange={(event) => patch("status", event.target.value as IdeaStatus)}>
                  {statusOrder.map((status) => (
                    <option key={status} value={status}>
                      {statusMeta[status].shortLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("common.priority")}</span>
                <select value={modifiedDraft.priority} onChange={(event) => patch("priority", event.target.value as Priority)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="field wide">
                <span>Tags</span>
                <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} />
              </label>
              <label className="field wide">
                <span>{t("idea.content")}</span>
                <textarea value={modifiedDraft.content} onChange={(event) => patch("content", event.target.value)} rows={7} />
              </label>
              <label className="field wide">
                <span>{t("idea.plan")}</span>
                <textarea value={modifiedDraft.plan} onChange={(event) => patch("plan", event.target.value)} rows={6} />
              </label>
              <label className="field wide">
                <span>{t("idea.notes")}</span>
                <textarea value={modifiedDraft.notes ?? ""} onChange={(event) => patch("notes", event.target.value)} rows={3} />
              </label>
            </div>

            <div className="todo-preview-list idea-modify-todos">
              {modifiedDraft.todos.map((todo, index) => (
                <div key={`${todo.title}-${index}`} className="todo-preview-row">
                  <input value={todo.title} onChange={(event) => patchTodo(index, { title: event.target.value })} placeholder={t("common.title")} />
                  <select value={todo.priority ?? "medium"} onChange={(event) => patchTodo(index, { priority: event.target.value as Priority })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <select value={todo.status ?? "todo"} onChange={(event) => patchTodo(index, { status: event.target.value as TodoStatus })}>
                    {todoStatusOrder.map((status) => (
                      <option key={status} value={status}>
                        {todoStatusMeta[status].label}
                      </option>
                    ))}
                  </select>
                  <input value={todo.tags?.join(", ") ?? ""} onChange={(event) => patchTodo(index, { tags: normalizeTags(event.target.value) })} placeholder="tags" />
                  <textarea value={todo.description ?? ""} onChange={(event) => patchTodo(index, { description: event.target.value })} placeholder={t("common.description")} rows={2} />
                  <button type="button" className="danger-button icon-button" onClick={() => removeTodo(index)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

function TodoFormFields({
  draft,
  onPatch,
}: {
  draft: TodoItem;
  onPatch: <K extends keyof TodoItem>(key: K, value: TodoItem[K]) => void;
}) {
  return (
    <div className="form-grid task-form-grid">
      <label className="field wide">
        <span>Title</span>
        <input value={draft.title} onChange={(event) => onPatch("title", event.target.value)} placeholder="可执行任务标题" autoFocus />
      </label>
      <label className="field">
        <span>Status</span>
        <select value={draft.status} onChange={(event) => onPatch("status", event.target.value as TodoStatus)}>
          {todoStatusOrder.map((status) => (
            <option key={status} value={status}>
              {todoStatusMeta[status].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Priority</span>
        <select value={draft.priority} onChange={(event) => onPatch("priority", event.target.value as Priority)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label className="field">
        <span>Due Date</span>
        <input type="date" value={draft.dueDate ?? ""} onChange={(event) => onPatch("dueDate", event.target.value)} />
      </label>
      <label className="field wide">
        <span>Tags</span>
        <input value={draft.tags?.join(", ") ?? ""} onChange={(event) => onPatch("tags", normalizeTags(event.target.value))} placeholder="reading, experiment" />
      </label>
      <label className="field wide">
        <span>Description</span>
        <textarea value={draft.description ?? ""} onChange={(event) => onPatch("description", event.target.value)} rows={4} />
      </label>
    </div>
  );
}

function DailyTodoEditorModal({
  todo,
  onClose,
  onSave,
}: {
  todo: DailyTodo;
  onClose: () => void;
  onSave: (todo: DailyTodo) => void;
}) {
  const [draft, setDraft] = useState<DailyTodo>(todo);
  const [tagsInput, setTagsInput] = useState(todo.tags.join(", "));

  function patch<K extends keyof DailyTodo>(key: K, value: DailyTodo[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ ...draft, tags: normalizeTags(tagsInput) });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="task-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Daily Todo</p>
            <h2>{todo.title ? "编辑 Daily Todo" : "新增 Daily Todo"}</h2>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="form-grid task-form-grid">
          <label className="field wide">
            <span>Title</span>
            <input value={draft.title} onChange={(event) => patch("title", event.target.value)} placeholder="任务标题" autoFocus />
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" value={draft.date} onChange={(event) => patch("date", event.target.value)} />
          </label>
          <label className="field">
            <span>Status</span>
            <select value={draft.status} onChange={(event) => patch("status", event.target.value as DailyTodoStatus)}>
              {todoStatusOrder.map((status) => (
                <option key={status} value={status}>
                  {todoStatusMeta[status].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={draft.priority} onChange={(event) => patch("priority", event.target.value as Priority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="field">
            <span>Tags</span>
            <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="work, life" />
          </label>
          <label className="field wide">
            <span>Description</span>
            <textarea value={draft.description ?? ""} onChange={(event) => patch("description", event.target.value)} rows={4} />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button">
            <Check size={18} />
            保存 Todo
          </button>
        </div>
      </form>
    </div>
  );
}

function IdeaDraftPreview({ draft }: { draft: IdeaDraft }) {
  return (
    <div className="draft-preview-grid">
      <div>
        <span>Title</span>
        <strong>{draft.title}</strong>
      </div>
      <div>
        <span>Status / Priority / Progress</span>
        <strong>
          {statusMeta[draft.status].shortLabel} · {priorityMeta[draft.priority].label} · {draft.todos.length} todos
        </strong>
      </div>
      <div>
        <span>Tags</span>
        <strong>{draft.tags.join(" / ")}</strong>
      </div>
      <div>
        <span>Repositories</span>
        <strong>{draft.repositories.length ? draft.repositories.map((repo) => repo.name || repo.urlOrPath).join(" / ") : "无"}</strong>
      </div>
      <div className="wide">
        <span>Content</span>
        <pre>{draft.content}</pre>
      </div>
      <div className="wide">
        <span>Plan</span>
        <pre>{draft.plan}</pre>
      </div>
      {draft.todos.length > 0 && (
        <div className="wide">
          <span>Initial Todos</span>
          <pre>{draft.todos.map((todo, index) => `${index + 1}. [${todo.priority ?? "medium"}] ${todo.title}${todo.description ? ` - ${todo.description}` : ""}`).join("\n")}</pre>
        </div>
      )}
      {draft.notes && (
        <div className="wide">
          <span>Notes</span>
          <pre>{draft.notes}</pre>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status, onClick }: { status: IdeaStatus; onClick?: (event: React.MouseEvent<HTMLSpanElement>) => void }) {
  return (
    <span className={`status-chip ${statusMeta[status].chip}`} onClick={onClick} title={onClick ? "点击切换状态" : undefined}>
      {statusMeta[status].shortLabel}
    </span>
  );
}

function PriorityChip({ priority }: { priority: Priority }) {
  return <span className={`priority-chip ${priorityMeta[priority].chip}`}>{priorityMeta[priority].label}</span>;
}
