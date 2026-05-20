import type { Idea, ThemeMode } from "./types";

const IDEAS_KEY = "new-ideas:ideas:v1";
const THEME_KEY = "new-ideas:theme:v1";

export function loadIdeas(): Idea[] {
  try {
    const raw = localStorage.getItem(IDEAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveIdeas(ideas: Idea[]) {
  localStorage.setItem(IDEAS_KEY, JSON.stringify(ideas));
}

export function loadTheme(): ThemeMode {
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

export function saveTheme(theme: ThemeMode) {
  localStorage.setItem(THEME_KEY, theme);
}

export function exportIdeas(ideas: Idea[]) {
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

export async function importIdeasFromFile(file: File): Promise<Idea[]> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as Idea[];
  if (Array.isArray(parsed.ideas)) return parsed.ideas as Idea[];
  throw new Error("导入文件不是有效的 NEW IDEAS 数据。");
}
