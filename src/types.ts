export type IdeaStatus = "not_started" | "in_progress" | "completed" | "abandoned";

export type Priority = "low" | "medium" | "high";

export type RepositoryType =
  | "local_folder"
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

export type ViewMode = "dashboard" | "list" | "board" | "settings";
export type SortMode = "updated_desc" | "priority_desc" | "created_desc" | "title_asc";
export type ThemeMode = "light" | "dark";
