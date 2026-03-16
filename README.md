# Mosaic

**Agentic environment inspired by scrolling and tiling window managers.**

Mosaic is a desktop app for directory-based workspaces, multi-pane layouts, and terminal-centric workflows.
It is designed to feel like a native shell for focused development: fast navigation, persistent layout state, and low-friction context switching.

## Current Feature Set

### Workspaces
- Open real directories as workspaces
- Switch workspaces from a rail/pill UI
- Workspace state is persisted between launches

### Panes, Splits, and Tabs
- Add panes and split panes vertically/horizontally
- Drag-resize pane boundaries
- Multiple tabs per pane
- Pane focus and pane movement tools
- Layout and pane-tab state persist between launches

### Pane Tab Types
Mosaic currently supports multiple pane/tab content types:
- Terminal
- Browser
- Editor (text/code)
- Markdown
- Image
- PDF

### Docked Side Tools
- **File picker dock** (left): directory tree + open file flow
- **Git pane dock** (right): branch/status surface with changed files, inline diffs, commit flow, commit log, and stash actions

### Navigation and Overview
- Overview mode for pane-level reorganization
- Minimap for quick pane targeting
- Command palette for fast actions
- Keyboard shortcuts are available and configurable from settings

### Visual System
- Theme/skin system is sourced from `src/core/themes.ts`
- Built to keep a restrained, dark, native-like desktop feel

## Persistence Notes

Persisted:
- Workspaces
- Layout tree (panes/splits)
- Pane tabs and active tab selection
- UI preferences (theme/orientation/dock widths)

Not persisted as full session replay:
- Live terminal process output/state after app exit
- Background jobs after app closes

## Platform + Stack

- Electron
- React + Vite
- Framer Motion
- `node-pty`
- `xterm` (renderer migration toward `ghostty-web` is in progress)

Targets:
- Windows
- macOS
- Linux

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Package

```bash
npm run package
```

Build output goes to `release/`.

## Key Paths

- `electron/main.mjs` — Electron lifecycle, PTY + Git + file/Git IPC
- `electron/preload.cjs` — renderer bridge
- `src/App.tsx` — shell, workspace switching, persistence, top-level controls
- `src/WorkspaceView.tsx` — workspace canvas, splits, overview/minimap, dock integration
- `src/components/TerminalPane.tsx` — pane chrome + tab UI + terminal integration
- `src/components/FileTreeSidebar.tsx` — file picker dock UI
- `src/components/GitSidebar.tsx` — git dock UI
- `src/core/layout.ts` — layout/split/resize operations
- `src/core/themes.ts` — theme source of truth
- `src/styles.css` — visual system

## Terminology

- **workspace** = selected directory at top level
- **pane** = top-level pane inside a workspace
- **split** = subdivision inside a pane
- **tab** = tab inside a pane/split

## License

[MIT](LICENSE)
