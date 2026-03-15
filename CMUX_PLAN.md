# cmux-Inspired Features for Mosaic

Features borrowed from cmux (macOS-only, libghostty-based terminal) adapted for Mosaic's cross-platform Electron stack.

## 1. Notification Rings
Panes light up when an agent or process needs attention. Visual ring/glow around the pane border when output arrives while you're focused elsewhere. Unread badge in the workspace sidebar. macOS/Windows/Linux desktop notifications via Electron's Notification API.

## 2. Vertical Tabs with Status
Sidebar shows live status per tab: git branch, working directory, active ports, and notification text. Agents or processes can write custom status lines. Progress bars for long-running tasks. At-a-glance view of what every pane is doing without switching to it.

## 3. In-App Browser
Split a browser alongside your terminal using Electron's `<webview>` tag. Scriptable API so agents can open URLs, click elements, type text, and read page content programmatically. Useful for localhost previews, docs, and automated web workflows.

## 4. Socket API / CLI
Agents can control Mosaic programmatically via a Unix socket (Linux/macOS) or named pipe (Windows). Commands: open panes, send keys, read screen output, split views, set status, trigger notifications. Enables AI coding agents to orchestrate their own workspace — spawn sub-agents, assign tasks, gather results.
