# Planned Pane Types

## 1. Browser Pane
Embedded webview inside a pane for localhost previews, docs, or dashboards. Uses Electron's `<webview>` tag. Needs URL bar, back/forward, and reload controls.

## 2. Notes Pane
Scratch notes per workspace with three modes:
- **Markdown** — write and preview rendered Markdown
- **Checklist** — simple TODO list with checkboxes
- **Kanban** — drag-and-drop task columns (e.g. Todo / In Progress / Done)

All modes persist per workspace. Pure React, no native dependencies.

## 3. Git Pane
Compact source control panel built into a pane. All operations run through the `git` CLI via IPC — no native Git library needed.

**UX layout (top to bottom):**
- **Branch bar** — current branch as a dropdown to switch branches, ahead/behind badges, pull/push buttons
- **Changed files** — color-coded list (M/A/D), click to expand inline diff, checkboxes to stage/unstage individually
- **Commit area** — single-line input for commit message, Commit button, optional amend toggle
- **Commit log** — scrollable recent commits with hash, message, author, relative time; click to view full diff inline
- **Stash drawer** — collapsible section to view, apply, or drop stash entries

**How it works:**
- Renderer sends requests (`git:status`, `git:checkout`, `git:commit`) through the preload bridge to the main process
- Main process runs `git` via `child_process.execFile` in the workspace directory and returns results
- Diffs parsed and rendered as green/red highlighted lines — pure text, no external diff tool
- Refreshes via polling `git status --porcelain` every 2-3 seconds, or after any action
- Auth inherited from the user's existing Git setup (SSH keys, credential manager)

**Cross-platform:** works on Windows, macOS, and Linux — `git` CLI is available on all three. No platform-specific code needed. Only requirement is `git` on PATH.

**Design:** no modals or popups, everything inline. Keyboard shortcuts (S to stage, C to commit, P to push). Dark, minimal, fits Mosaic's visual style.

## 4. File Viewer Pane
Read-only code or log viewer. Reads files from the workspace directory via IPC. Needs syntax highlighting and large-file scrolling.

## 5. File Tree
Workspace file explorer — makes Mosaic feel like an IDE.

**Placement:** default as a fixed sidebar on the left of each workspace (like VS Code). Can also be popped out into a standalone pane for flexible layouts.

**How it works:**
- Main process reads the workspace directory via `fs.readdir` with lazy loading — only expands folders when clicked
- Watches expanded directories with `fs.watch` so the tree updates live on file changes
- Click a file → opens it in a File Viewer pane
- Right-click context menu → new file, new folder, rename, delete, copy path
- Drag a file onto a terminal pane → pastes the file path into the terminal
- Search/filter bar at the top to find files by name

**Performance:** lazy expansion means no full tree scan upfront. Respects `.gitignore` by default. Skips `node_modules`, `.git`, `dist` unless explicitly expanded.

**Cross-platform:** `fs.readdir` and `fs.watch` work on Windows, macOS, and Linux. Uses `path.join` for path separators — no platform-specific code.

**Design:** collapsible tree with indent guides, file type icons (folder, JS, TS, JSON, MD, image, etc.), toggle for hidden files. Dark, compact, fits Mosaic's visual style.

## 6. Image / Media Preview Pane
Displays images and media assets from the workspace directory. Simple `<img>` render with zoom/pan. Lightweight, no heavy dependencies.

---

# OSS Integrations

Open source tools that can be embedded into Mosaic panes.

## Easy

**Excalidraw** — hand-drawn style whiteboard (shapes, arrows, freeform drawing). Single React component, save as JSON. MIT. `@excalidraw/excalidraw`

**tldraw** — polished whiteboard/canvas tool. Smoother and more modern than Excalidraw. Single React component, save as JSON. MIT. `tldraw`

**Mermaid** — renders diagrams (flowcharts, sequence, ERD, Gantt) from plain text. Tiny footprint, just outputs SVG. MIT. `mermaid`

**BlockNote** — Notion-like block editor with slash commands, drag-and-drop blocks, tables, toggles. Best upgrade for the Notes pane. Single React component, save as JSON. MIT. `@blocknote/react`

**CodeMirror** — lightweight code editor with syntax highlighting. Modular — pick only what you need. Smaller and faster than Monaco. Good for config files and quick edits. MIT. `@codemirror/view`

## Medium

**Monaco Editor** — the actual VS Code editor engine. Full syntax highlighting, IntelliSense, autocomplete, minimap. Turns File Viewer into a real code editor. Heavy (~5MB), needs language worker config. MIT. `@monaco-editor/react`

**Milkdown** — WYSIWYG Markdown editor with a plugin system. More Markdown-native than BlockNote — notes are real `.md` files on disk. More setup but more customizable. MIT. `@milkdown/kit`

## Hard (webview or background service required)

**Hoppscotch** — open source Postman alternative. API testing with collections and environments. Full standalone app — embed via `<webview>` or rebuild a simplified version. MIT.

**Directus** — database GUI and headless CMS. Browse tables, run queries, manage data. Runs as a separate server — embed via `<webview>`. Overkill for a simple DB pane; better to build a lightweight query runner instead. GPL.

**Grafana Panels** — embeddable monitoring charts (CPU, memory, request rates). Needs a running Grafana instance and data source. Only useful if the user already runs Grafana. Power-user integration. AGPL.
