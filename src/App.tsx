import {
  Archive,
  ArrowDownAZ,
  Calendar,
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
  Layers3,
  Link2,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
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
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyIdeaContent,
  emptyIdeaPlan,
  priorityMeta,
  repositoryTypeLabels,
  statusMeta,
  statusOrder,
} from "./constants";
import { draftToIdea, fetchLlmModels, generateIdeaWithAI, ideaToDraft, organizeIdeaWithAI, testLlmConnection } from "./ai";
import { defaultSettings, exportIdeas, importIdeasFromFile, loadAppData, saveIdeas, saveSettings } from "./storage";
import type {
  AppSettings,
  Idea,
  IdeaDraft,
  IdeaStatus,
  LlmSettings,
  Priority,
  RelatedRepository,
  RepositoryType,
  SortMode,
  TestConnectionResult,
  ThemeMode,
  ViewMode,
} from "./types";
import {
  createId,
  formatDate,
  formatDateOnly,
  matchesIdea,
  nextStatus,
  normalizeTags,
  sortIdeas,
  summarizeMarkdown,
} from "./utils";

type StatusFilter = IdeaStatus | "all";

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

const createBlankIdea = (): Idea => {
  const now = new Date().toISOString();
  return {
    id: createId("idea"),
    title: "",
    content: emptyIdeaContent,
    plan: emptyIdeaPlan,
    repositories: [],
    status: "not_started",
    tags: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    progress: 0,
  };
};

export default function App() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [storageReady, setStorageReady] = useState(false);
  const [view, setView] = useState<ViewMode>("dashboard");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("updated_desc");
  const [selectedId, setSelectedId] = useState("");
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    loadAppData()
      .then((data) => {
        if (!active) return;
        setIdeas(data.ideas);
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
    if (storageReady) void saveIdeas(ideas);
  }, [ideas, storageReady]);

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

  function updateIdea(updatedIdea: Idea) {
    const ideaWithTimestamp = { ...updatedIdea, updatedAt: new Date().toISOString() };
    setIdeas((current) => current.map((idea) => (idea.id === ideaWithTimestamp.id ? ideaWithTimestamp : idea)));
    setSelectedId(ideaWithTimestamp.id);
  }

  function saveModalIdea(idea: Idea) {
    const now = new Date().toISOString();
    const normalized: Idea = {
      ...idea,
      title: idea.title.trim() || "未命名科研 idea",
      tags: normalizeTags(idea.tags),
      repositories: idea.repositories.filter((repo) => repo.name.trim() || repo.urlOrPath.trim()),
      updatedAt: now,
      createdAt: idea.createdAt || now,
      progress: Math.min(100, Math.max(0, Number(idea.progress ?? 0))),
    };

    setIdeas((current) => {
      const exists = current.some((item) => item.id === normalized.id);
      return exists ? current.map((item) => (item.id === normalized.id ? normalized : item)) : [normalized, ...current];
    });
    setSelectedId(normalized.id);
    setEditingIdea(null);
  }

  function changeIdeaStatus(id: string, status: IdeaStatus) {
    setIdeas((current) =>
      current.map((idea) => (idea.id === id ? { ...idea, status, updatedAt: new Date().toISOString() } : idea)),
    );
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

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importIdeasFromFile(file);
      setIdeas(imported);
      setSelectedId(imported[0]?.id ?? "");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导入失败。");
    } finally {
      event.target.value = "";
    }
  }

  function openRepository(repo: RelatedRepository) {
    if (/^https?:\/\//i.test(repo.urlOrPath)) {
      void openShell(repo.urlOrPath);
      return;
    }
    if (repo.urlOrPath.trim()) void openShell(repo.urlOrPath);
  }

  function copyRepositoryPath(repo: RelatedRepository) {
    navigator.clipboard?.writeText(repo.urlOrPath);
  }

  const shellClass = settings.theme === "dark" ? "theme-dark" : "theme-light";

  return (
    <main className={`app-shell ${shellClass}`}>
      <Sidebar
        ideas={ideas}
        view={view}
        statusFilter={statusFilter}
        tagFilter={tagFilter}
        allTags={allTags}
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

        {view === "dashboard" && (
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

        {view === "board" && (
          <IdeasBoard
            ideas={filteredIdeas}
            onSelect={(idea) => setSelectedId(idea.id)}
            onEdit={(idea) => setEditingIdea(idea)}
            onStatusChange={changeIdeaStatus}
          />
        )}

        {view === "list" && (
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
              onStatusChange={changeIdeaStatus}
              onOpenRepository={openRepository}
              onCopyRepository={copyRepositoryPath}
            />
          </section>
        )}

        {view === "settings" && (
          <SettingsPage
            settings={settings}
            ideaCount={ideas.length}
            onSettingsChange={setSettings}
            onExport={() => exportIdeas(ideas)}
            onImport={() => importInputRef.current?.click()}
          />
        )}
      </section>

      <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />

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
    </main>
  );
}

function Sidebar({
  ideas,
  view,
  statusFilter,
  tagFilter,
  allTags,
  onViewChange,
  onStatusFilter,
  onTagFilter,
}: {
  ideas: Idea[];
  view: ViewMode;
  statusFilter: StatusFilter;
  tagFilter: string;
  allTags: string[];
  onViewChange: (view: ViewMode) => void;
  onStatusFilter: (status: StatusFilter) => void;
  onTagFilter: (tag: string) => void;
}) {
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

      <nav className="nav-section">
        <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => onViewChange("dashboard")}>
          <Home size={18} />
          <span>Dashboard</span>
        </button>
        <button className={`nav-item ${view === "board" ? "active" : ""}`} onClick={() => onViewChange("board")}>
          <Layers3 size={18} />
          <span>Ideas Board</span>
        </button>
      </nav>

      <div className="sidebar-label">状态分类</div>
      <nav className="nav-section">
        <button className={`nav-item ${statusFilter === "all" && view === "list" ? "active" : ""}`} onClick={() => onStatusFilter("all")}>
          <Archive size={18} />
          <span>全部 ideas</span>
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
              <span>{statusMeta[status].shortLabel}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-label">标签筛选</div>
      <div className="tag-cloud">
        <button className={`mini-chip ${tagFilter === "all" ? "selected" : ""}`} onClick={() => onTagFilter("all")}>
          全部
        </button>
        {allTags.slice(0, 14).map((tag) => (
          <button key={tag} className={`mini-chip ${tagFilter === tag ? "selected" : ""}`} onClick={() => onTagFilter(tag)}>
            {tag}
          </button>
        ))}
      </div>

      <button className={`settings-link ${view === "settings" ? "active" : ""}`} onClick={() => onViewChange("settings")}>
        <Settings size={18} />
        <span>Settings</span>
      </button>
    </aside>
  );
}

function Header({
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
  const title =
    view === "dashboard"
      ? "科研想法总览"
      : view === "board"
        ? "Ideas 看板"
        : view === "settings"
          ? "设置"
          : statusFilter === "all"
            ? "全部 ideas"
            : statusMeta[statusFilter].label;

  const subtitle =
    view === "settings"
      ? "本地数据、主题与后续扩展入口"
      : view === "board"
        ? "横向追踪每个科研 idea 的推进状态"
        : view === "dashboard"
          ? "沉淀灵感、推进研究路线、关联文档仓库"
          : statusFilter === "all"
            ? "按标题、内容和标签实时搜索"
            : statusMeta[statusFilter].description;

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Research Workspace</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="topbar-actions">
        <label className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索标题、内容、标签..." />
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
          看板
        </button>
        <button className="ghost-button ai-button" onClick={onAiNewIdea}>
          <Sparkles size={18} />
          AI 新建 Idea
        </button>
        <button className="primary-button" onClick={onNewIdea}>
          <Plus size={18} />
          新建 Idea
        </button>
      </div>
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
  const highPriority = ideas.filter((idea) => idea.priority === "high").length;
  const averageProgress = ideas.length
    ? Math.round(ideas.reduce((sum, idea) => sum + Number(idea.progress ?? 0), 0) / ideas.length)
    : 0;

  return (
    <section className="dashboard">
      <div className="overview-band">
        <div>
          <p className="eyebrow">Idea pipeline</p>
          <h2>从灵感池到论文成果，一屏看清研究路线。</h2>
          <p>把问题背景、技术路线、实验计划和文档仓库放在同一个轻量桌面工作台里。</p>
        </div>
        <div className="hero-actions">
          <button className="ghost-button ai-button" onClick={onAiNewIdea}>
            <Sparkles size={18} />
            AI 新建 Idea
          </button>
          <button className="primary-button" onClick={onNewIdea}>
            <Plus size={18} />
            记录新灵感
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
            <span>{idea.progress ?? 0}%</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${idea.progress ?? 0}%` }} />
          </div>
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
  onStatusChange,
  onOpenRepository,
  onCopyRepository,
}: {
  idea?: Idea;
  onEdit: (idea: Idea) => void;
  onDelete: (id: string) => void;
  onAbandon: (idea: Idea) => void;
  onStatusChange: (id: string, status: IdeaStatus) => void;
  onOpenRepository: (repo: RelatedRepository) => void;
  onCopyRepository: (repo: RelatedRepository) => void;
}) {
  if (!idea) {
    return (
      <section className="detail-panel empty-detail">
        <FileText size={36} />
        <h2>选择一个 idea 查看详情</h2>
      </section>
    );
  }

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
          <Calendar size={16} />
          Target {idea.targetDate ? formatDateOnly(idea.targetDate) : "未设置"}
        </span>
        <span>
          <Tag size={16} />
          {idea.tags.length ? idea.tags.join(" / ") : "暂无标签"}
        </span>
      </div>

      <section className="detail-section">
        <h3>Content</h3>
        <pre>{idea.content}</pre>
      </section>

      <section className="detail-section">
        <h3>Plan</h3>
        <pre>{idea.plan}</pre>
      </section>

      <section className="detail-section">
        <div className="section-title compact">
          <h3>Related Document Repository</h3>
          <span>{idea.repositories.length}</span>
        </div>
        {idea.repositories.length === 0 ? (
          <p className="muted-text">还没有关联仓库、论文、数据集或本地路径。</p>
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
                <button className="text-icon-button" title="打开" onClick={() => onOpenRepository(repo)}>
                  {/https?:\/\//i.test(repo.urlOrPath) ? <ExternalLink size={17} /> : <FolderOpen size={17} />}
                </button>
                <button className="text-icon-button" title="复制路径" onClick={() => onCopyRepository(repo)}>
                  <ClipboardCopy size={17} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {idea.notes && (
        <section className="detail-section">
          <h3>Notes</h3>
          <p>{idea.notes}</p>
        </section>
      )}
    </section>
  );
}

function IdeasBoard({
  ideas,
  onSelect,
  onEdit,
  onStatusChange,
}: {
  ideas: Idea[];
  onSelect: (idea: Idea) => void;
  onEdit: (idea: Idea) => void;
  onStatusChange: (id: string, status: IdeaStatus) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  return (
    <section className="board">
      {statusOrder.map((status) => {
        const columnIdeas = ideas.filter((idea) => idea.status === status);
        const Icon = statusMeta[status].icon;
        return (
          <div
            key={status}
            className="board-column"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggedId) onStatusChange(draggedId, status);
              setDraggedId(null);
            }}
          >
            <div className="board-heading">
              <Icon size={18} />
              <strong>{statusMeta[status].shortLabel}</strong>
              <span>{columnIdeas.length}</span>
            </div>
            <div className="board-stack">
              {columnIdeas.map((idea) => (
                <article
                  key={idea.id}
                  className="board-card"
                  draggable
                  onDragStart={() => setDraggedId(idea.id)}
                  onClick={() => onSelect(idea)}
                >
                  <div className="card-topline">
                    <PriorityChip priority={idea.priority} />
                    <button className="text-icon-button" onClick={(event) => {
                      event.stopPropagation();
                      onEdit(idea);
                    }}>
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
                </article>
              ))}
              {columnIdeas.length === 0 && <div className="board-empty">拖拽 idea 到这里</div>}
            </div>
          </div>
        );
      })}
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
  const { theme, llm } = settings;
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>(() => defaultModelOptions(llm.provider));
  const [modelListMessage, setModelListMessage] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const updateTheme = (nextTheme: ThemeMode) => onSettingsChange({ ...settings, theme: nextTheme });
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
          <h2>本地数据</h2>
          <p>当前通过 IndexedDB 持久化，Tauri 桌面端离线可用。已保存 {ideaCount} 条 ideas。</p>
        </div>
        <div className="settings-actions">
          <button className="ghost-button" onClick={onImport}>
            <Upload size={18} />
            导入
          </button>
          <button className="primary-button" onClick={onExport}>
            <Download size={18} />
            导出
          </button>
        </div>
      </div>

      <div className="settings-card">
        {theme === "dark" ? <Moon size={22} /> : <Sun size={22} />}
        <div>
          <h2>主题</h2>
          <p>浅色适合白天阅读，深色适合长时间写作和夜间整理。</p>
        </div>
        <div className="segmented">
          <button className={theme === "light" ? "active" : ""} onClick={() => updateTheme("light")}>
            浅色
          </button>
          <button className={theme === "dark" ? "active" : ""} onClick={() => updateTheme("dark")}>
            深色
          </button>
        </div>
      </div>

      <div className="settings-card settings-form-card">
        <Sparkles size={22} />
        <div>
          <h2>LLM 配置</h2>
          <p>AI 新建和 AI 整理通过 Tauri command 调用 LLM Provider。配置保存在本地工作区。</p>
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
          {!llm.apiKey.trim() && <p className="settings-warning">未配置 API Key 时，AI 新建和 AI 整理会显示配置提示。</p>}
          <div className="settings-actions llm-actions">
            <button className="ghost-button" onClick={refreshModels} disabled={modelsLoading}>
              <RefreshCw size={18} />
              {modelsLoading ? "刷新中..." : "刷新模型列表"}
            </button>
            <button className="primary-button" onClick={testConnection} disabled={testLoading}>
              <Sparkles size={18} />
              {testLoading ? "测试中..." : "测试连接"}
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
          <h2>关于 NEW IDEAS</h2>
          <p>MVP 已预留 SQLite、Markdown 编辑器、附件管理、云同步和 Tauri 文件打开能力的接入位置。</p>
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
  const [draft, setDraft] = useState<Idea>(idea);
  const [tagsInput, setTagsInput] = useState(idea.tags.join(", "));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

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

  async function organizeWithAI() {
    setAiLoading(true);
    setAiError("");
    try {
      const result = await organizeIdeaWithAI(ideaToDraft({ ...draft, tags: normalizeTags(tagsInput) }), llmSettings);
      setDraft(draftToIdea(result, draft));
      setTagsInput(result.tags.join(", "));
    } catch (currentError) {
      setAiError(currentError instanceof Error ? currentError.message : String(currentError));
    } finally {
      setAiLoading(false);
    }
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
            <button type="button" className="ghost-button ai-button" onClick={organizeWithAI} disabled={aiLoading}>
              <Sparkles size={18} />
              {aiLoading ? "整理中..." : "AI 整理"}
            </button>
            <button type="button" className="ghost-button icon-button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {aiError && <div className="error-banner">{aiError}</div>}

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

          <label className="field">
            <span>Target Date</span>
            <input type="date" value={draft.targetDate ?? ""} onChange={(event) => patch("targetDate", event.target.value)} />
          </label>

          <label className="field">
            <span>Progress</span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.progress ?? 0}
              onChange={(event) => patch("progress", Number(event.target.value))}
            />
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
            <span>Plan</span>
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
          {statusMeta[draft.status].shortLabel} · {priorityMeta[draft.priority].label} · {draft.progress ?? 0}%
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
