# NEW IDEAS

NEW IDEAS is a Tauri 2 + React + TypeScript desktop local workspace for research ideas, project todo tracking, and daily task records. It is designed as a local-first tool: user data, LLM settings, and task records are stored on the user's device unless explicitly exported.

中文简述：NEW IDEAS 是一个本地优先的桌面工作区，支持科研 idea 管理、Project Todo、Daily Todo、AI 辅助整理和中英文界面切换。

## Workspaces

### Research Ideas

The Research Ideas workspace is used to capture and develop research ideas. Each research idea can contain:

- title, content, research plan, notes, tags, priority, and status
- related document repositories, local files, local folders, and external links
- Project Todo items that represent executable progress

Plan and Todo have different roles:

- Plan is the research route or conceptual plan.
- Todo is executable work and progress tracking.

`targetDate` is no longer part of the core UI. It remains only as a legacy optional field for older imported records.

### Project Todo

Each research idea has its own Project Todo list. Project Todo supports:

- create, edit, delete
- status: `todo`, `in_progress`, `done`, `cancelled`
- priority: `low`, `medium`, `high`
- tags, due date, completed timestamp, and ordering
- automatic `completedAt` when a todo is marked done
- automatic idea `updatedAt` when todo data changes
- automatic idea progress based on `done / active todos`; cancelled items are excluded

Idea cards and the board show todo progress such as `3/8 completed`.

### Daily Todo

Daily Todo is a separate general-purpose task workspace. It does not include research fields such as content, plan, repositories, hypotheses, or novelty.

Daily Todo supports:

- Today view and historical date selection
- create, edit, delete, complete, cancel, and restore
- status grouping: To Do, In Progress, Done, Cancelled
- priority, tags, description, search, and tag filtering
- date-level stats: total tasks, done, in progress, not started, completion rate
- clearing completed tasks for the selected date

### Daily Todo to Project Todo

Daily Todo items can be copied into a research idea as Project Todo items. The source Daily Todo is not deleted.

Mapping:

- `DailyTodo.title` -> `TodoItem.title`
- `DailyTodo.description` -> `TodoItem.description`
- `DailyTodo.status` -> `TodoItem.status`
- `DailyTodo.priority` -> `TodoItem.priority`
- `DailyTodo.tags` -> `TodoItem.tags`
- `DailyTodo.completedAt` -> `TodoItem.completedAt` when status is done
- `TodoItem.id` is regenerated
- `TodoItem.createdAt`, `updatedAt`, and `order` are generated at import time
- `TodoItem.source` stores the original Daily Todo id and date

## AI Features

All AI requests go through Tauri commands and the Rust provider adapter. The frontend does not hard-code API keys.

Supported AI flows:

- AI New Idea: natural language to structured research idea draft
- AI Organize Idea: improve an existing idea draft before saving
- AI Generate Project Todo: generate executable todos from an idea's title, content, plan, and notes
- AI Organize Daily Todo: convert natural language daily planning text into Daily Todo drafts

AI-generated Project Todo and Daily Todo items are shown in a preview/editor first. They are not saved until the user confirms.

The LLM provider adapter supports:

- OpenAI-compatible
- OpenAI
- Anthropic

Settings include:

- Provider
- Base URL
- API Key
- Model
- refresh model list
- test connection

OpenAI-compatible providers use `GET {baseUrl}/models` for model refresh and `POST {baseUrl}/chat/completions` for chat calls. Anthropic uses the Messages API.

## Related Document Repository

Research ideas can link to:

- GitHub, Overleaf, or regular HTTP/HTTPS URLs
- local folders
- local files
- PDF files
- datasets
- other paths or links

Repository actions:

- Open: URLs open with the system default browser; local files and folders open with the desktop runtime and system default app/file manager
- Copy Path / URL
- Reveal in Folder for local paths

Opening local files requires the Tauri desktop runtime. In a plain browser development context, the UI reports that local opening requires the desktop runtime.

## Language

The Settings page includes a language switch:

- English
- Simplified Chinese

The setting is stored locally and loaded on app startup. The visible workspace UI, todo controls, settings, AI actions, and repository actions use the lightweight dictionary in `src/i18n/`.

## Local Data and Migration

The current storage adapter uses IndexedDB:

- `ideas`: Research Ideas and Project Todo
- `dailyTodos`: Daily Todo records
- `settings`: theme, language, and LLM settings
- `meta`: migration state and schema version

The current schema is `schemaVersion = 2`.

Migration behavior:

- legacy `localStorage` key `new-ideas:ideas:v1` is migrated to IndexedDB on first startup
- older ideas automatically receive `todos: []`
- idea progress is recalculated from Project Todo
- Daily Todo uses an independent store
- migration metadata prevents repeated migrations

## Privacy Notes

- API keys are stored in the local workspace settings.
- User data is stored locally by the storage adapter.
- Do not commit `.env`, API keys, local databases, private exports, or private task data.
- Exported JSON files can contain user data and should be reviewed before publishing.

## Development

Install dependencies:

```bash
npm install
```

Run the Tauri desktop app:

```bash
npm run tauri:dev
```

Run the frontend dev server:

```bash
npm run dev
```

Build the frontend:

```bash
npm run build
```

Run Rust tests:

```bash
cd src-tauri
cargo test
```

Build the desktop app:

```bash
npm run tauri:build
```

## Project Structure

```text
.
├─ public/
│  └─ assets/
├─ src/
│  ├─ ai.ts
│  ├─ App.tsx
│  ├─ constants.ts
│  ├─ dailyTodoAiService.ts
│  ├─ i18n/
│  ├─ main.tsx
│  ├─ sampleData.ts
│  ├─ storage.ts
│  ├─ styles.css
│  ├─ types.ts
│  └─ utils.ts
├─ src-tauri/
│  ├─ capabilities/
│  ├─ icons/
│  ├─ src/
│  └─ tauri.conf.json
└─ package.json
```

## Verification Checklist

1. Create a Research Idea and add Project Todo manually.
2. Generate Project Todo with AI and confirm that the preview must be applied before saving.
3. Create Daily Todo records for today and a historical date.
4. Generate Daily Todo with AI from natural language and confirm that preview items are editable.
5. Copy Daily Todo items into a Research Idea as Project Todo.
6. Switch UI language in Settings and reload the app.
7. Open a GitHub URL, local folder, and local file from Related Document Repository in the Tauri desktop runtime.
