export type IdeaStatus = "not_started" | "in_progress" | "completed" | "abandoned";

export type Priority = "low" | "medium" | "high";

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
  repositories: RelatedRepository[];
  status: IdeaStatus;
  tags: string[];
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  targetDate?: string;
  progress?: number;
  notes?: string;
}

export interface IdeaDraft {
  title: string;
  content: string;
  plan: string;
  repositories: Omit<RelatedRepository, "id">[];
  status: IdeaStatus;
  tags: string[];
  priority: Priority;
  targetDate?: string;
  progress?: number;
  notes?: string;
}

export type LlmProvider = "openai_compatible" | "openai" | "local" | "custom";

export interface LlmSettings {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AppSettings {
  theme: ThemeMode;
  llm: LlmSettings;
}

export interface StorageMigrationState {
  localStorageV1Completed: boolean;
  completedAt?: string;
}

export interface AppData {
  ideas: Idea[];
  settings: AppSettings;
  migration: StorageMigrationState;
}

export type ViewMode = "dashboard" | "list" | "board" | "settings";
export type SortMode = "updated_desc" | "priority_desc" | "created_desc" | "title_asc";
export type ThemeMode = "light" | "dark";
