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
  "04_shared_resources/common_scripts",
  "04_shared_resources/fluent_templates",
  "04_shared_resources/literature",
  "04_shared_resources/mesh_templates",
  "04_shared_resources/plotting_templates",
  "04_shared_resources/solidworks_templates",
  "04_shared_resources/spaceclaim_templates",
  "99_archive",
  "docs/adr",
  "templates/project_template/00_docs",
  "templates/project_template/01_literature/bibtex",
  "templates/project_template/01_literature/notes",
  "templates/project_template/01_literature/papers",
  "templates/project_template/02_geometry/cad_templates",
  "templates/project_template/02_geometry/images",
  "templates/project_template/02_geometry/parameters",
  "templates/project_template/02_geometry/parasolid",
  "templates/project_template/02_geometry/step",
  "templates/project_template/03_mesh/mesh_independence",
  "templates/project_template/03_mesh/mesh_reports",
  "templates/project_template/03_mesh/mesh_scripts",
  "templates/project_template/03_mesh/msh",
  "templates/project_template/04_fluent/case",
  "templates/project_template/04_fluent/data",
  "templates/project_template/04_fluent/journal",
  "templates/project_template/04_fluent/logs",
  "templates/project_template/04_fluent/monitors",
  "templates/project_template/04_fluent/pyfluent",
  "templates/project_template/04_fluent/residuals",
  "templates/project_template/04_fluent/udf",
  "templates/project_template/05_results/contours",
  "templates/project_template/05_results/plots",
  "templates/project_template/05_results/processed_data",
  "templates/project_template/05_results/raw_exports",
  "templates/project_template/05_results/summary",
  "templates/project_template/05_results/tables",
  "templates/project_template/06_analysis/metrics",
  "templates/project_template/06_analysis/notebooks",
  "templates/project_template/06_analysis/reports",
  "templates/project_template/06_analysis/scripts",
  "templates/project_template/07_ai_model/checkpoints",
  "templates/project_template/07_ai_model/dataset",
  "templates/project_template/07_ai_model/inference",
  "templates/project_template/07_ai_model/models",
  "templates/project_template/07_ai_model/preprocessing",
  "templates/project_template/07_ai_model/training",
  "templates/project_template/08_manuscript/cover_letter",
  "templates/project_template/08_manuscript/drafts",
  "templates/project_template/08_manuscript/figures",
  "templates/project_template/08_manuscript/response_to_reviewers",
  "templates/project_template/08_manuscript/tables",
  "templates/project_template/99_archive",
  "templates/project_template/llmwiki",
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
      "- `04_shared_resources/`: reusable scripts, templates, papers, and assets.",
      "- `templates/project_template/`: copied when a formal project is created.",
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
      "Formal projects are created only by a manual Project Promotion action. Promotion creates a `Pxxx_project_name` folder in `01_active_projects/`, writes source idea material into project docs, updates `project_index.md`, and links the project folder back to the app idea.",
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
  [
    "templates/project_template/README.md",
    [
      "# Project Template",
      "",
      "This folder is copied when New Ideas promotes a Research Idea into a Formal Project.",
      "",
    ].join("\n"),
  ],
  [
    "templates/project_template/project_config.yaml",
    [
      "project_id: TBD",
      "project_name: TBD",
      "status: Draft",
      "main_tools: TBD",
      "project_type: TBD",
      "",
    ].join("\n"),
  ],
  ["templates/project_template/changelog.md", "# Changelog\n"],
  ["templates/project_template/research_plan.md", "# Research Plan\n"],
  ["templates/project_template/todo.md", "# Todo\n"],
  ["templates/project_template/00_docs/idea_origin.md", "# Idea Origin\n"],
  ["templates/project_template/00_docs/research_questions.md", "# Research Questions\n"],
  ["templates/project_template/00_docs/method_plan.md", "# Method Plan\n"],
  ["templates/project_template/00_docs/simulation_plan.md", "# Simulation Plan\n"],
  ["templates/project_template/00_docs/data_requirement.md", "# Data Requirement\n"],
  ["templates/project_template/00_docs/experiment_log.md", "# Experiment Log\n"],
  ["templates/project_template/00_docs/paper_notes.md", "# Paper Notes\n"],
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
