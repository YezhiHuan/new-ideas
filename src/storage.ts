import type { AppData, AppSettings, DailyTodo, Idea, StorageMigrationState, ThemeMode } from "./types";
import { normalizeTags, sortDailyTodos, withCalculatedIdeaProgress } from "./utils";

const DB_NAME = "new-ideas-workspace";
const DB_VERSION = 2;
const SCHEMA_VERSION = 2;
const IDEAS_STORE = "ideas";
const DAILY_TODOS_STORE = "dailyTodos";
const SETTINGS_STORE = "settings";
const META_STORE = "meta";

const OLD_IDEAS_KEY = "new-ideas:ideas:v1";
const OLD_THEME_KEY = "new-ideas:theme:v1";
const MIGRATION_KEY = "localStorageV1";
const SCHEMA_KEY = "schemaVersion";
const SETTINGS_KEY = "app";

export const defaultSettings: AppSettings = {
  theme: "light",
  language: "zh",
  llm: {
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4.1-mini",
  },
};

export interface StorageAdapter {
  loadAppData(): Promise<AppData>;
  loadIdeas(): Promise<Idea[]>;
  saveIdeas(ideas: Idea[]): Promise<void>;
  loadDailyTodos(): Promise<DailyTodo[]>;
  saveDailyTodos(todos: DailyTodo[]): Promise<void>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  saveTheme(theme: ThemeMode): Promise<void>;
  exportIdeas(ideas: Idea[]): void;
  importIdeasFromFile(file: File): Promise<Idea[]>;
}

class IndexedDbStorageAdapter implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async loadAppData(): Promise<AppData> {
    await this.migrateLocalStorageV1();
    await this.migrateSchemaV2();
    const [ideas, dailyTodos, settings, migration] = await Promise.all([
      this.loadIdeas(),
      this.loadDailyTodos(),
      this.loadSettings(),
      this.loadMigrationState(),
    ]);
    return { schemaVersion: SCHEMA_VERSION, ideas, dailyTodos, settings, migration };
  }

  async loadIdeas(): Promise<Idea[]> {
    const db = await this.openDb();
    return (await this.readAll<Idea>(db, IDEAS_STORE)).map(normalizeIdea);
  }

  async saveIdeas(ideas: Idea[]): Promise<void> {
    const db = await this.openDb();
    await this.replaceAll(db, IDEAS_STORE, ideas.map(normalizeIdea));
  }

  async loadDailyTodos(): Promise<DailyTodo[]> {
    const db = await this.openDb();
    return sortDailyTodos((await this.readAll<DailyTodo>(db, DAILY_TODOS_STORE)).map(normalizeDailyTodo));
  }

  async saveDailyTodos(todos: DailyTodo[]): Promise<void> {
    const db = await this.openDb();
    await this.replaceAll(db, DAILY_TODOS_STORE, sortDailyTodos(todos.map(normalizeDailyTodo)));
  }

  async loadSettings(): Promise<AppSettings> {
    const db = await this.openDb();
    const stored = await this.read<AppSettings>(db, SETTINGS_STORE, SETTINGS_KEY);
    return mergeSettings(stored);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const db = await this.openDb();
    await this.write(db, SETTINGS_STORE, SETTINGS_KEY, mergeSettings(settings));
  }

  async saveTheme(theme: ThemeMode): Promise<void> {
    const settings = await this.loadSettings();
    await this.saveSettings({ ...settings, theme });
  }

  exportIdeas(ideas: Idea[]) {
    const payload = {
      app: "NEW IDEAS",
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      ideas: ideas.map(normalizeIdea),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `new-ideas-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async importIdeasFromFile(file: File): Promise<Idea[]> {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return (parsed as Idea[]).map(normalizeIdea);
    if (Array.isArray(parsed.ideas)) return (parsed.ideas as Idea[]).map(normalizeIdea);
    throw new Error("导入文件不是有效的 NEW IDEAS 数据。");
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDEAS_STORE)) {
          db.createObjectStore(IDEAS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(DAILY_TODOS_STORE)) {
          db.createObjectStore(DAILY_TODOS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("无法打开 IndexedDB。"));
    });
    return this.dbPromise;
  }

  private async migrateLocalStorageV1() {
    const db = await this.openDb();
    const existing = await this.read<StorageMigrationState>(db, META_STORE, MIGRATION_KEY);
    if (existing?.localStorageV1Completed) return;

    const ideas = readLegacyIdeas();
    const legacyTheme = readLegacyTheme();
    if (ideas.length) {
      const currentIdeas = await this.readAll<Idea>(db, IDEAS_STORE);
      if (currentIdeas.length === 0) {
        await this.replaceAll(db, IDEAS_STORE, ideas.map(normalizeIdea));
      }
    }
    if (legacyTheme) {
      const settings = await this.loadSettings();
      await this.saveSettings({ ...settings, theme: legacyTheme });
    }

    await this.write(db, META_STORE, MIGRATION_KEY, {
      localStorageV1Completed: true,
      completedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    } satisfies StorageMigrationState);
  }

  private async migrateSchemaV2() {
    const db = await this.openDb();
    const currentVersion = await this.read<number>(db, META_STORE, SCHEMA_KEY);
    if (currentVersion && currentVersion >= SCHEMA_VERSION) return;

    const ideas = await this.readAll<Idea>(db, IDEAS_STORE);
    if (ideas.length) {
      await this.replaceAll(db, IDEAS_STORE, ideas.map(normalizeIdea));
    }
    await this.write(db, META_STORE, SCHEMA_KEY, SCHEMA_VERSION);
  }

  private loadMigrationState(): Promise<StorageMigrationState> {
    return this.openDb().then(async (db) => {
      const stored = await this.read<StorageMigrationState>(db, META_STORE, MIGRATION_KEY);
      return stored ?? { localStorageV1Completed: false, schemaVersion: SCHEMA_VERSION };
    });
  }

  private read<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error(`无法读取 ${storeName}。`));
    });
  }

  private readAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve((request.result as T[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error(`无法读取 ${storeName}。`));
    });
  }

  private write<T>(db: IDBDatabase, storeName: string, key: IDBValidKey, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error(`无法写入 ${storeName}。`));
    });
  }

  private replaceAll<T>(db: IDBDatabase, storeName: string, values: T[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.clear();
      values.forEach((value) => store.put(value));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error(`无法更新 ${storeName}。`));
    });
  }
}

function normalizeIdea(idea: Idea): Idea {
  return withCalculatedIdeaProgress({
    ...idea,
    repositories: Array.isArray(idea.repositories) ? idea.repositories : [],
    tags: normalizeTags(Array.isArray(idea.tags) ? idea.tags : []),
    progress: Number(idea.progress ?? 0),
    todos: Array.isArray(idea.todos) ? idea.todos : [],
  });
}

function normalizeDailyTodo(todo: DailyTodo): DailyTodo {
  const now = new Date().toISOString();
  const status = todo.status === "in_progress" || todo.status === "done" || todo.status === "cancelled" ? todo.status : "todo";
  return {
    ...todo,
    id: todo.id || `daily_${Date.now().toString(36)}`,
    title: todo.title?.trim() || "未命名任务",
    description: todo.description?.trim() || undefined,
    status,
    priority: todo.priority === "low" || todo.priority === "high" ? todo.priority : "medium",
    date: todo.date || now.slice(0, 10),
    createdAt: todo.createdAt || now,
    updatedAt: todo.updatedAt || now,
    completedAt: status === "done" ? todo.completedAt || now : undefined,
    tags: normalizeTags(Array.isArray(todo.tags) ? todo.tags : []),
    order: Number.isFinite(todo.order) ? todo.order : 0,
  };
}

function mergeSettings(settings?: Partial<AppSettings>): AppSettings {
  const llm = settings?.llm;
  return {
    ...defaultSettings,
    ...settings,
    language: settings?.language === "en" ? "en" : "zh",
    llm: {
      ...defaultSettings.llm,
      ...llm,
      provider: normalizeProvider(llm?.provider),
    },
  };
}

function normalizeProvider(provider?: string) {
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  return "openai-compatible";
}

function readLegacyIdeas() {
  try {
    const raw = localStorage.getItem(OLD_IDEAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Idea[]) : [];
  } catch {
    return [];
  }
}

function readLegacyTheme(): ThemeMode | undefined {
  return localStorage.getItem(OLD_THEME_KEY) === "dark" ? "dark" : undefined;
}

export const storageAdapter: StorageAdapter = new IndexedDbStorageAdapter();

export const loadAppData = () => storageAdapter.loadAppData();
export const loadIdeas = () => storageAdapter.loadIdeas();
export const saveIdeas = (ideas: Idea[]) => storageAdapter.saveIdeas(ideas);
export const loadDailyTodos = () => storageAdapter.loadDailyTodos();
export const saveDailyTodos = (todos: DailyTodo[]) => storageAdapter.saveDailyTodos(todos);
export const loadSettings = () => storageAdapter.loadSettings();
export const saveSettings = (settings: AppSettings) => storageAdapter.saveSettings(settings);
export const saveTheme = (theme: ThemeMode) => storageAdapter.saveTheme(theme);
export const exportIdeas = (ideas: Idea[]) => storageAdapter.exportIdeas(ideas);
export const importIdeasFromFile = (file: File) => storageAdapter.importIdeasFromFile(file);
