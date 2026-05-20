import type { AppData, AppSettings, Idea, StorageMigrationState, ThemeMode } from "./types";

const DB_NAME = "new-ideas-workspace";
const DB_VERSION = 1;
const IDEAS_STORE = "ideas";
const SETTINGS_STORE = "settings";
const META_STORE = "meta";

const OLD_IDEAS_KEY = "new-ideas:ideas:v1";
const OLD_THEME_KEY = "new-ideas:theme:v1";
const MIGRATION_KEY = "localStorageV1";
const SETTINGS_KEY = "app";

export const defaultSettings: AppSettings = {
  theme: "light",
  llm: {
    provider: "openai_compatible",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
  },
};

export interface StorageAdapter {
  loadAppData(): Promise<AppData>;
  loadIdeas(): Promise<Idea[]>;
  saveIdeas(ideas: Idea[]): Promise<void>;
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
    const [ideas, settings, migration] = await Promise.all([
      this.loadIdeas(),
      this.loadSettings(),
      this.loadMigrationState(),
    ]);
    return { ideas, settings, migration };
  }

  async loadIdeas(): Promise<Idea[]> {
    const db = await this.openDb();
    return this.readAll<Idea>(db, IDEAS_STORE);
  }

  async saveIdeas(ideas: Idea[]): Promise<void> {
    const db = await this.openDb();
    await this.replaceAll(db, IDEAS_STORE, ideas);
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
      version: 1,
      exportedAt: new Date().toISOString(),
      ideas,
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
    if (Array.isArray(parsed)) return parsed as Idea[];
    if (Array.isArray(parsed.ideas)) return parsed.ideas as Idea[];
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
        await this.replaceAll(db, IDEAS_STORE, ideas);
      }
    }
    if (legacyTheme) {
      const settings = await this.loadSettings();
      await this.saveSettings({ ...settings, theme: legacyTheme });
    }

    await this.write(db, META_STORE, MIGRATION_KEY, {
      localStorageV1Completed: true,
      completedAt: new Date().toISOString(),
    } satisfies StorageMigrationState);
  }

  private loadMigrationState(): Promise<StorageMigrationState> {
    return this.openDb().then(async (db) => {
      const stored = await this.read<StorageMigrationState>(db, META_STORE, MIGRATION_KEY);
      return stored ?? { localStorageV1Completed: false };
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

  private replaceAll(db: IDBDatabase, storeName: string, values: Idea[]): Promise<void> {
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

function mergeSettings(settings?: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    llm: {
      ...defaultSettings.llm,
      ...settings?.llm,
    },
  };
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
export const loadSettings = () => storageAdapter.loadSettings();
export const saveSettings = (settings: AppSettings) => storageAdapter.saveSettings(settings);
export const saveTheme = (theme: ThemeMode) => storageAdapter.saveTheme(theme);
export const exportIdeas = (ideas: Idea[]) => storageAdapter.exportIdeas(ideas);
export const importIdeasFromFile = (file: File) => storageAdapter.importIdeasFromFile(file);
