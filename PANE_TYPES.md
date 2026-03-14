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

## 5. Image / Media Preview Pane
Displays images and media assets from the workspace directory. Simple `<img>` render with zoom/pan. Lightweight, no heavy dependencies.
