# Contributing to Mosaic

Thanks for your interest in contributing! Mosaic is a desktop app for directory-based workspaces with tiled terminal panes.

## Getting Started

```bash
git clone https://github.com/<owner>/Mosaic.git
cd Mosaic
npm install
npm run dev
```

This starts both the Vite dev server and Electron concurrently.

## Project Structure

| Path | Description |
|---|---|
| `electron/main.mjs` | Electron main process — window creation, terminal (node-pty) management, IPC |
| `electron/preload.cjs` | Context-isolated bridge between main and renderer |
| `src/App.tsx` | App shell — workspace switching, settings, keyboard shortcuts |
| `src/WorkspaceView.tsx` | Workspace surface and pane layout tree |
| `src/components/TerminalPane.tsx` | Terminal pane UI and xterm wiring |
| `src/core/layout.ts` | Pane/tab creation, split operations, layout tree helpers |
| `src/core/themes.ts` | Available skins and terminal color palettes |
| `src/core/workspaces.ts` | Workspace naming and persistence helpers |
| `src/styles.css` | Visual system |

## Terminology

Use these terms consistently:

- **workspace** — a selected directory that opens as its own top-level working area
- **pane** — a top-level pane inside a workspace
- **split** — a subdivision inside an existing pane
- **tab** — one terminal tab inside a single pane or split

## Code Style

- The project uses tabs for indentation and double quotes for strings.
- A `.prettierrc` and `.eslintrc.json` are included — please follow them.
- Mimic the style of surrounding code when editing existing files.

## Making Changes

1. Create a feature branch from `main`.
2. Make small, focused commits.
3. Test on Windows (native Electron) when possible — WSL rendering can differ.
4. Run `npm run build` to verify the production build succeeds.

## Design Guidelines

- Dark, clean, glassy, but restrained.
- Prefer clarity and speed over decorative blur.
- Motion should feel crisp and intentional, not flashy.

## Reporting Issues

Open an issue with:
- Steps to reproduce
- Expected vs. actual behavior
- Whether the issue appears on Windows, WSL, or both
