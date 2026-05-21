export type IdeaStatus = "not_started" | "in_progress" | "completed" | "abandoned";

export type Priority = "low" | "medium" | "high";

export type TodoStatus = "todo" | "in_progress" | "done" | "cancelled";

export type DailyTodoStatus = TodoStatus;

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: Priority;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  completedAt?: string;
  order: number;
  source?: {
    type: "daily_todo";
    id: string;
    date: string;
  };
}

export interface TodoDraft {
  title: string;
  description?: string;
  status?: TodoStatus;
  priority?: Priority;
  dueDate?: string | null;
  tags?: string[];
}

export interface DailyTodo {
  id: string;
  title: string;
  description?: string;
  status: DailyTodoStatus;
  priority: Priority;
  date: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  tags: string[];
  order: number;
}

export type RepositoryType =
  | "local_folder"
  | "local_file"
  | "github"
  | "overleaf"
  | "pdf"
  | "dataset"
  | "other";

export interface RelatedRepository {
  id: string;
  name: string;
  type: RepositoryType;
  urlOrPath: string;
  note?: string;
  indexedAt?: string;
  fileSize?: number;
  extension?: string;
}

export interface Idea {
  id: string;
  title: string;
  content: string;
  plan: string;
  todos: TodoItem[];
  repositories: RelatedRepository[];
  status: IdeaStatus;
  tags: string[];
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  /** Legacy field kept for imported/old records. It is no longer shown in the core UI. */
  targetDate?: string;
  progress?: number;
  notes?: string;
}

export interface IdeaDraft {
  title: string;
  content: string;
  plan: string;
  todos: TodoDraft[];
  repositories: Omit<RelatedRepository, "id">[];
  status: IdeaStatus;
  tags: string[];
  priority: Priority;
  /** Legacy field kept for backwards-compatible imports and AI responses. */
  targetDate?: string;
  progress?: number;
  notes?: string;
}

export type LlmProvider = "openai-compatible" | "openai" | "anthropic";

export interface LlmSettings {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TestConnectionResult {
  ok: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  message: string;
  statusCode?: number;
  rawError?: string;
}

export interface AppSettings {
  theme: ThemeMode;
  language: Language;
  llm: LlmSettings;
}

export interface StorageMigrationState {
  localStorageV1Completed: boolean;
  completedAt?: string;
  schemaVersion?: number;
}

export interface AppData {
  schemaVersion: number;
  ideas: Idea[];
  dailyTodos: DailyTodo[];
  settings: AppSettings;
  migration: StorageMigrationState;
}

export type AppMode = "research" | "daily";
export type ViewMode = "dashboard" | "list" | "board" | "daily" | "settings";
export type SortMode = "updated_desc" | "priority_desc" | "created_desc" | "title_asc";
export type ThemeMode = "light" | "dark";
export type Language = "en" | "zh";
