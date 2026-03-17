# Mosaic

Mosaic is a desktop workspace for people who live in the terminal.

It gives you directory-based workspaces, panes, splits, tabs, and a calmer visual shell around terminal-heavy work. The goal is not to replace the terminal. The goal is to make terminal workflows easier to organize, monitor, and return to.

<p align="center">
  <video src="./docs/media/mosaic-overview.mp4" controls autoplay loop muted playsinline width="960"></video>
</p>

If the inline player does not render in your viewer, open `docs/media/mosaic-overview.mp4` directly.

## What It Does

- Open real directories as workspaces
- Show each workspace as its own navigable surface, with path and git context in the workspace tab itself
- Add new panes to the right inside a workspace without squeezing the existing layout; each new pane opens at half the width of a full lone pane
- Split the current pane vertically or horizontally within its existing pane area, dividing only that pane's current space
- Resize pane widths and heights with draggable dividers or keyboard shortcuts
- Move focus between panes with the keyboard
- Open multiple tabs inside each pane
- Persist workspaces, pane layouts, and pane tabs between launches
- Start new terminals in the selected workspace directory
- Show lightweight git status for each workspace
- Support multiple visual skins from `src/core/themes.ts`

What does not persist yet:

- terminal process contents
- shell history inside a live session
- background jobs after the app closes

## Current Direction

Mosaic is currently:

- cross-platform (Windows, macOS, Linux)
- Electron-based
- powered by `node-pty` (renderer migrating from `xterm.js` to `ghostty-web`)
- focused on fast iteration around layout, navigation, and workspace UX

The longer-term direction is to keep the product model strong and the architecture replaceable, so the shell and terminal engine can evolve later without throwing away the workspace ideas.

## Screens and Concepts

Core ideas in the current build:

- vertical workspace rail by default
- settings tucked into a small contextual menu
- themed skin picker that recolors the shell without restarting terminals
- compact path labels like `.../parent/current`
- browser-like pane tabs inside each pane
- persistent layout scaffolding without pretending terminal state is magically resumable

## Terminology

Mosaic uses four main words:

- `workspace` = a selected directory that opens as its own top-level working area
- `pane` = a top-level pane inside a workspace
- `split` = a subdivision inside an existing pane
- `tab` = a terminal tab inside a pane or split

When needed:

- `workspace tab` = the item in the workspace rail
- `pane tab` = the browser-like tab inside a pane

## Shortcuts

Shortcuts are fully configurable in **Settings → Shortcuts**.

Default highlights:

- `Ctrl+Shift+O` — open workspace
- `Ctrl+Shift+Enter` — new pane
- `Ctrl+K` — command palette
- `Ctrl+,` — open settings

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

Build distributable binaries for your platform:

```bash
npm run package
```

Output goes to `release/`.

## Project Structure

- `electron/main.mjs` — Electron window setup, PTY sessions, directory picker, workspace inspection
- `electron/preload.cjs` — renderer bridge
- `src/App.tsx` — shell, workspace navigation, settings, persistence
- `src/WorkspaceView.tsx` — workspace surface and pane layout
- `src/components/TerminalPane.tsx` — pane chrome, pane tabs, terminal mount
- `src/core/layout.ts` — pane split, tab layout, focus movement, and resize helpers
- `src/core/workspaces.ts` — workspace naming and persistence helpers
- `src/core/themes.ts` — available skins and terminal palettes
- `src/styles.css` — visual system

## License

[MIT](LICENSE)
