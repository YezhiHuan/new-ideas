import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const defaultRoot = path.resolve(projectDir, "..", "ResearchProjects");

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const root = path.resolve(argValue("--root") ?? process.env.RESEARCH_ROOT ?? defaultRoot);

const directories = [
  "00_idea_pool",
  "01_active_projects",
  "02_paused_projects",
  "03_finished_projects",
  "04_shared_resources",
  "99_archive",
  "docs/adr",
  "templates/project_template/00_docs",
  "templates/project_template/99_archive",
];

const files = new Map([
  [
    ".gitignore",
    [
      "# Local research artifacts",
      "**/*.cas",
      "**/*.dat",
      "**/*.msh",
      "**/*.h5",
      "**/*.zip",
      "**/*.7z",
      "**/checkpoints/",
      "**/raw_exports/",
      "",
    ].join("\n"),
  ],
  [
    "README.md",
    [
      "# ResearchProjects",
      "",
      "ResearchProjects is the local filesystem workspace managed by NEW IDEAS.",
      "",
      "- `00_idea_pool/`: idea mirrors written by NEW IDEAS.",
      "- `01_active_projects/`: formal project folders created by project promotion.",
      "- `04_shared_resources/`: optional reusable scripts, templates, papers, and assets created by users as needed.",
      "- `templates/project_template/`: minimal formal project template containing only `00_docs/` and `99_archive/`; users create project-specific folders as needed.",
      "",
    ].join("\n"),
  ],
  [
    "CONTEXT.md",
    [
      "# Context Glossary",
      "",
      "## New Ideas",
      "",
      "Local desktop control surface for capturing research ideas, shaping research routes, and tracking executable todos.",
      "",
      "## ResearchProjects Root",
      "",
      "App-managed local filesystem workspace used by New Ideas for idea mirrors, formal project folders, project indexes, templates, and shared research resources. It is initialized by command, not manually assembled. By default it is a sibling of the `New-Ideas` folder so the app and research workspace can move together across devices.",
      "",
      "## Research Idea",
      "",
      "An early research direction before formal project approval. It may contain background, core question, route, notes, repositories, and project todos.",
      "",
      "## Idea Mirror",
      "",
      "File-system snapshot of a Research Idea under the idea pool. New Ideas remains the source of truth.",
      "",
      "## Idea Pool",
      "",
      "Holding area for Research Ideas that are not yet approved as formal projects.",
      "",
      "## Project Promotion",
      "",
      "Manual decision to turn a Research Idea into a Formal Project.",
      "",
      "## Formal Project",
      "",
      "Approved research project with a project ID, project folder, index entry, research plan, todos, and project materials.",
      "",
      "## Project Todo",
      "",
      "Executable research task attached to a Research Idea or Formal Project.",
      "",
    ].join("\n"),
  ],
  [
    "global_conventions.md",
    [
      "# Global Conventions",
      "",
      "- Project IDs use `P001` style.",
      "- Idea mirror IDs use `I001` style.",
      "- Formal project folders use `Pxxx_project_name`.",
      "- New Ideas is the source of truth for active idea editing.",
      "- Manual file edits are not imported back into New Ideas automatically.",
      "",
    ].join("\n"),
  ],
  [
    "idea_pool.md",
    [
      "# Idea Pool",
      "",
      "Idea mirrors live in `00_idea_pool/`.",
      "",
    ].join("\n"),
  ],
  [
    "project_index.md",
    [
      "| ID | Name | Status | Main Tool | Type | Path | Notes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "",
    ].join("\n"),
  ],
  ["00_idea_pool/new_ideas.md", "# New Ideas\n"],
  ["00_idea_pool/abandoned_ideas.md", "# Abandoned Ideas\n"],
  ["00_idea_pool/future_directions.md", "# Future Directions\n"],
  ["00_idea_pool/literature_questions.md", "# Literature Questions\n"],
  [
    "docs/adr/0001-new-ideas-mirror-and-manual-promotion.md",
    [
      "# 0001 New Ideas Mirror And Manual Promotion",
      "",
      "## Status",
      "",
      "Accepted",
      "",
      "## Context",
      "",
      "New Ideas captures early research ideas and project todos in a local desktop app. ResearchProjects stores long-term research folders, project indexes, simulation artifacts, manuscript material, and shared resources.",
      "",
      "Directly creating formal project folders whenever an idea changes status would be too easy to trigger by accident. Keeping all research only inside the app would make long-term project materials harder to inspect, version, and reuse from the file system.",
      "",
      "## Decision",
      "",
      "New Ideas writes each research idea to an Idea Mirror under `00_idea_pool/`.",
      "",
      "Formal projects are created only by a manual Project Promotion action. Promotion creates a `Pxxx_project_name` folder in `01_active_projects/`, starts from a minimal template containing only `00_docs/` and `99_archive/`, writes source idea material into project docs, updates `project_index.md`, and links the project folder back to the app idea.",
      "",
      "ResearchProjects Root is initialized by command so the app depends on a repeatable folder contract rather than a hand-built local directory. By default it sits next to the `New-Ideas` folder so app code and research workspace can move together across devices.",
      "",
      "## Consequences",
      "",
      "New Ideas stays the source of truth for active idea editing. `00_idea_pool/` provides readable file-system snapshots. Formal project creation remains controlled and explicit.",
      "",
      "Manual edits to mirror files are not automatically imported back into New Ideas.",
      "",
    ].join("\n"),
  ],
  ["templates/project_template/00_docs/idea_origin.md", "# Idea Origin\n"],
]);

async function writeIfMissing(relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
}

for (const directory of directories) {
  await mkdir(path.join(root, directory), { recursive: true });
}

for (const [relativePath, content] of files) {
  await writeIfMissing(relativePath, content);
}

console.log(`ResearchProjects root ready: ${root}`);
