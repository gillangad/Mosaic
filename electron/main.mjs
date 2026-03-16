import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import os from "node:os";
import pty from "node-pty";
import ignore from "ignore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const sessions = new Map();

function closeTrackedSession(session) {
	if (!session || session.closed || session.closing) return;
	session.closing = true;
	try {
		session.proc.kill();
	} catch {
		session.closed = true;
		sessions.delete(session.id);
	}
}

function normalizeSubscriptionPayload(payload) {
	if (typeof payload === "string") {
		return {
			id: payload,
			subscriptionId: null,
		};
	}

	if (!payload || typeof payload !== "object") return null;
	if (typeof payload.id !== "string") return null;
	return {
		id: payload.id,
		subscriptionId: typeof payload.subscriptionId === "string" ? payload.subscriptionId : null,
	};
}

if (process.platform === "linux") {
	app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch("remote-debugging-port", "9222");

function resolveWindowsDefaultShell() {
	const wherePwsh = spawnSync("where.exe", ["pwsh.exe"], {
		encoding: "utf8",
		windowsHide: true,
	});
	if (wherePwsh.status === 0) {
		const onPath = wherePwsh.stdout.split(/\r?\n/).find(Boolean)?.trim();
		if (onPath) return onPath;
		return "pwsh.exe";
	}

	const candidates = [
		process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "PowerShell", "7", "pwsh.exe") : null,
		process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "PowerShell", "7", "pwsh.exe") : null,
		process.env.ProgramW6432 ? path.join(process.env.ProgramW6432, "PowerShell", "7", "pwsh.exe") : null,
	].filter(Boolean);

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	return process.env.ComSpec || "cmd.exe";
}

function getDefaultShell() {
	if (process.platform === "win32") {
		return resolveWindowsDefaultShell();
	}

	return process.env.SHELL || "/bin/bash";
}

async function readWorkspaceGitStatus(directoryPath) {
	try {
		const { stdout: rootStdout } = await execFileAsync("git", ["-C", directoryPath, "rev-parse", "--show-toplevel"]);
		const rootPath = rootStdout.trim();
		const { stdout: statusStdout } = await execFileAsync("git", ["-C", directoryPath, "status", "--porcelain=v1", "--branch"]);
		const lines = statusStdout.split(/\r?\n/).filter(Boolean);
		const branchLine = lines.find((line) => line.startsWith("# branch.head "));
		const aheadBehindLine = lines.find((line) => line.startsWith("# branch.ab "));
		const branchName = branchLine?.replace("# branch.head ", "").trim() || null;
		const statusLines = lines.filter((line) => !line.startsWith("#"));
		const dirty = statusLines.length > 0;
		let ahead = 0;
		let behind = 0;

		if (aheadBehindLine) {
			const match = aheadBehindLine.match(/\+(\d+)\s+\-(\d+)/);
			if (match) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
		}

		const parts = [branchName && branchName !== "(detached)" ? branchName : "detached"];
		if (dirty) {
			parts.push(`${statusLines.length} change${statusLines.length === 1 ? "" : "s"}`);
		} else {
			parts.push("clean");
		}
		if (ahead) parts.push(`+${ahead}`);
		if (behind) parts.push(`-${behind}`);

		return {
			isRepo: true,
			branch: branchName,
			summary: parts.join(" • "),
			dirty,
			ahead,
			behind,
			changeCount: statusLines.length,
			rootPath,
		};
	} catch {
		return {
			isRepo: false,
			branch: null,
			summary: "No git repository detected",
			dirty: false,
			ahead: 0,
			behind: 0,
			changeCount: 0,
			rootPath: null,
		};
	}
}

async function inspectWorkspace(directoryPath) {
	return {
		path: directoryPath,
		git: await readWorkspaceGitStatus(directoryPath),
	};
}

const FILE_TREE_EXCLUDED_SEGMENTS = new Set(["node_modules", ".git", "dist"]);

function normalizeRelativePath(value) {
	return value.replace(/\\/g, "/");
}

function ensureInsideWorkspace(workspacePath, targetPath) {
	const resolvedWorkspacePath = path.resolve(workspacePath);
	const resolvedTargetPath = path.resolve(targetPath);
	const relative = path.relative(resolvedWorkspacePath, resolvedTargetPath);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
		return resolvedTargetPath;
	}
	throw new Error("Path is outside the workspace root.");
}

async function buildWorkspaceIgnoreMatcher(workspacePath) {
	const matcher = ignore();
	try {
		const gitignorePath = path.join(workspacePath, ".gitignore");
		const raw = await readFile(gitignorePath, "utf8");
		matcher.add(raw);
	} catch {
		// No .gitignore found.
	}
	return matcher;
}

function isHardExcluded(relativePath) {
	const segments = normalizeRelativePath(relativePath).split("/").filter(Boolean);
	return segments.some((segment) => FILE_TREE_EXCLUDED_SEGMENTS.has(segment));
}

function isIgnoredPath(_matcher, relativePath, _isDirectory) {
	if (!relativePath) return false;
	if (isHardExcluded(relativePath)) return true;
	return false;
}

async function listWorkspaceDirectory(workspacePath, directoryPath) {
	const safeWorkspacePath = path.resolve(workspacePath);
	const safeDirectoryPath = ensureInsideWorkspace(safeWorkspacePath, directoryPath || safeWorkspacePath);
	const matcher = await buildWorkspaceIgnoreMatcher(safeWorkspacePath);
	const entries = await readdir(safeDirectoryPath, { withFileTypes: true });

	const visibleEntries = entries
		.filter((entry) => {
			const absolutePath = path.join(safeDirectoryPath, entry.name);
			const relativePath = normalizeRelativePath(path.relative(safeWorkspacePath, absolutePath));
			return !isIgnoredPath(matcher, relativePath, entry.isDirectory());
		})
		.map((entry) => {
			const absolutePath = path.join(safeDirectoryPath, entry.name);
			const relativePath = normalizeRelativePath(path.relative(safeWorkspacePath, absolutePath));
			const extensionIndex = entry.name.lastIndexOf(".");
			return {
				name: entry.name,
				path: absolutePath,
				relativePath,
				isDirectory: entry.isDirectory(),
				extension: extensionIndex > 0 ? entry.name.slice(extensionIndex + 1).toLowerCase() : "",
			};
		})
		.sort((left, right) => {
			if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
			return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
		});

	return visibleEntries;
}

async function listCdpTargets() {
	try {
		const response = await fetch("http://127.0.0.1:9222/json/list");
		if (!response.ok) return [];
		const targets = await response.json();
		return Array.isArray(targets) ? targets : [];
	} catch {
		return [];
	}
}

function parseTargetDescription(target) {
	if (!target || typeof target.description !== "string") return null;
	try {
		const parsed = JSON.parse(target.description);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

async function resolveBrowserCdpTarget(webContentsId, url, title) {
	const targets = await listCdpTargets();
	if (!Number.isFinite(webContentsId) || webContentsId <= 0) return null;

	for (const target of targets) {
		if (!target || typeof target !== "object") continue;
		const description = parseTargetDescription(target);
		if (description && Number(description.webContentsId) === webContentsId) {
			return {
				id: String(target.id ?? ""),
				webSocketDebuggerUrl: String(target.webSocketDebuggerUrl ?? ""),
				url: String(target.url ?? ""),
				title: String(target.title ?? ""),
			};
		}
	}

	if (typeof url === "string" && url.trim().length > 0) {
		const byUrl = targets.find((target) => target?.url === url && typeof target?.webSocketDebuggerUrl === "string");
		if (byUrl) {
			return {
				id: String(byUrl.id ?? ""),
				webSocketDebuggerUrl: String(byUrl.webSocketDebuggerUrl ?? ""),
				url: String(byUrl.url ?? ""),
				title: String(byUrl.title ?? ""),
			};
		}
	}

	if (typeof title === "string" && title.trim().length > 0) {
		const byTitle = targets.find((target) => target?.title === title && typeof target?.webSocketDebuggerUrl === "string");
		if (byTitle) {
			return {
				id: String(byTitle.id ?? ""),
				webSocketDebuggerUrl: String(byTitle.webSocketDebuggerUrl ?? ""),
				url: String(byTitle.url ?? ""),
				title: String(byTitle.title ?? ""),
			};
		}
	}

	return null;
}

function createWindow() {
	const isMac = process.platform === "darwin";

	const win = new BrowserWindow({
		width: 1480,
		height: 920,
		minWidth: 1100,
		minHeight: 720,
		backgroundColor: "#0c0c0e",
		autoHideMenuBar: true,
		titleBarStyle: isMac ? "hiddenInset" : "hidden",
		titleBarOverlay: isMac
			? false
			: {
				color: "#0c0c0e",
				symbolColor: "#71717a",
				height: 36,
			},
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webviewTag: true,
		},
	});

	const devUrl = process.env.ELECTRON_RENDERER_URL;
	if (devUrl) {
		win.loadURL(devUrl).catch((error) => {
			win.loadURL(
				`data:text/html,${encodeURIComponent(`<html><body style="background:#0a0a0f;color:#e5e7eb;font-family:sans-serif;padding:24px"><h2>Mosaic failed to load the renderer</h2><pre>${String(error)}</pre></body></html>`)}`,
			);
		});
		return;
	}

	win.loadFile(path.join(__dirname, "..", "dist", "index.html")).catch((error) => {
		win.loadURL(
			`data:text/html,${encodeURIComponent(`<html><body style="background:#0a0a0f;color:#e5e7eb;font-family:sans-serif;padding:24px"><h2>Mosaic failed to load the app</h2><pre>${String(error)}</pre></body></html>`)}`,
		);
	});
}

function createPtySession(options = {}) {
	const id = crypto.randomUUID();
	const shell = getDefaultShell();
	const cwd = options.cwd || os.homedir();

	const localBinPath = path.join(__dirname, "..", "node_modules", ".bin");
	const basePath = process.env.PATH ?? process.env.Path ?? "";
	const mergedPath = [localBinPath, basePath].filter(Boolean).join(path.delimiter);
	const spawnOptions = {
		name: "xterm-256color",
		env: {
			...process.env,
			PATH: mergedPath,
			Path: mergedPath,
		},
		cols: 120,
		rows: 36,
	};

	let proc;
	try {
		proc = pty.spawn(shell, [], {
			...spawnOptions,
			cwd,
		});
	} catch {
		try {
			proc = pty.spawn(shell, [], {
				...spawnOptions,
				cwd: os.homedir(),
			});
		} catch {
			const fallbackShell = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : process.env.SHELL || "/bin/bash";
			proc = pty.spawn(fallbackShell, [], {
				...spawnOptions,
				cwd: os.homedir(),
			});
		}
	}

	const session = {
		id,
		proc,
		shell,
		cwd,
		closing: false,
		closed: false,
	};

	proc.onExit(() => {
		session.closed = true;
		session.closing = false;
		sessions.delete(id);
	});

	sessions.set(id, session);
	return { id, shell, cwd };
}

ipcMain.handle("terminal:create", (_event, options) => {
	const session = createPtySession(options);
	return session;
});

ipcMain.handle("workspace:pickDirectory", async () => {
	const result = await dialog.showOpenDialog({
		properties: ["openDirectory"],
	});

	if (result.canceled || result.filePaths.length === 0) return null;
	return inspectWorkspace(result.filePaths[0]);
});

ipcMain.handle("workspace:inspect", (_event, directoryPath) => inspectWorkspace(directoryPath));

ipcMain.handle("fs:readDir", async (_event, payload) => {
	if (!payload || typeof payload !== "object") {
		throw new Error("Invalid directory read payload.");
	}
	const workspacePath = typeof payload.workspacePath === "string" ? payload.workspacePath : "";
	const directoryPath = typeof payload.directoryPath === "string" ? payload.directoryPath : workspacePath;
	if (!workspacePath) {
		throw new Error("workspacePath is required.");
	}
	return listWorkspaceDirectory(workspacePath, directoryPath);
});

ipcMain.handle("fs:readFile", async (_event, filePath) => {
	if (typeof filePath !== "string" || filePath.length === 0) {
		throw new Error("filePath is required.");
	}
	return readFile(filePath, "utf8");
});

ipcMain.handle("fs:readFileBase64", async (_event, filePath) => {
	if (typeof filePath !== "string" || filePath.length === 0) {
		throw new Error("filePath is required.");
	}
	const buffer = await readFile(filePath);
	return buffer.toString("base64");
});

ipcMain.handle("fs:writeFile", async (_event, payload) => {
	if (!payload || typeof payload !== "object" || typeof payload.filePath !== "string") {
		throw new Error("Invalid write payload.");
	}
	await writeFile(payload.filePath, typeof payload.contents === "string" ? payload.contents : "", "utf8");
});

ipcMain.handle("browser:getCdpTarget", async (_event, payload) => {
	if (!payload || typeof payload !== "object") return null;
	const webContentsId = Number(payload.webContentsId ?? 0);
	const url = typeof payload.url === "string" ? payload.url : "";
	const title = typeof payload.title === "string" ? payload.title : "";
	return resolveBrowserCdpTarget(webContentsId, url, title);
});

ipcMain.handle("window:updateTitleBarOverlay", (event, payload = {}) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || process.platform === "darwin") return;
	const overlayColor = payload.overlayColor ?? payload.backgroundColor ?? "#0c0c0e";
	const symbolColor = payload.symbolColor ?? "#71717a";
	win.setBackgroundColor(payload.backgroundColor ?? overlayColor);
	if (typeof win.setTitleBarOverlay === "function") {
		win.setTitleBarOverlay({
			color: overlayColor,
			symbolColor,
			height: 36,
		});
	}
});

ipcMain.handle("terminal:write", (_event, payload) => {
	const session = sessions.get(payload.id);
	if (!session || session.closed) return;
	try {
		session.proc.write(payload.data);
	} catch {
		// Ignore writes for sessions that are in the middle of closing.
	}
});

ipcMain.handle("terminal:resize", (_event, payload) => {
	const session = sessions.get(payload.id);
	if (!session || session.closed) return;
	try {
		session.proc.resize(payload.cols, payload.rows);
	} catch {
		// Ignore resize races during teardown.
	}
});

ipcMain.handle("terminal:close", (_event, id) => {
	const session = sessions.get(id);
	if (!session) return;
	closeTrackedSession(session);
});

ipcMain.on("terminal:subscribe", (event, payload) => {
	const normalized = normalizeSubscriptionPayload(payload);
	if (!normalized) return;

	const { id, subscriptionId } = normalized;
	const session = sessions.get(id);
	if (!session || session.closed) return;

	let cleaned = false;
	let dataDisposable;
	let exitDisposable;

	function cleanup() {
		if (cleaned) return;
		cleaned = true;
		dataDisposable?.dispose();
		exitDisposable?.dispose();
		ipcMain.removeListener("terminal:unsubscribe", unsubscribeListener);
		event.sender.removeListener("destroyed", handleSenderDestroyed);
	}

	function handleSenderDestroyed() {
		cleanup();
	}

	function unsubscribeListener(unsubscribeEvent, message) {
		if (unsubscribeEvent.sender !== event.sender) return;
		if (!message || message.id !== id) return;
		if (subscriptionId && message.subscriptionId !== subscriptionId) return;
		cleanup();
	}

	const sendData = (data) => {
		if (event.sender.isDestroyed()) {
			cleanup();
			return;
		}
		event.sender.send(`terminal:data:${id}`, data);
	};

	const sendExit = (eventData) => {
		if (!event.sender.isDestroyed()) {
			event.sender.send(`terminal:exit:${id}`, eventData);
		}
		cleanup();
	};

	dataDisposable = session.proc.onData(sendData);
	exitDisposable = session.proc.onExit(sendExit);

	ipcMain.on("terminal:unsubscribe", unsubscribeListener);
	event.sender.once("destroyed", handleSenderDestroyed);
});

ipcMain.on("context-menu:terminal", (event, payload) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win) return;

	const menu = Menu.buildFromTemplate([
		{
			label: "Copy",
			accelerator: "CmdOrCtrl+C",
			click: () => event.sender.send("context-menu:action", { action: "copy", sessionId: payload?.sessionId }),
		},
		{
			label: "Paste",
			accelerator: "CmdOrCtrl+V",
			click: () => event.sender.send("context-menu:action", { action: "paste", sessionId: payload?.sessionId }),
		},
		{ type: "separator" },
		{
			label: "Select All",
			accelerator: "CmdOrCtrl+A",
			click: () => event.sender.send("context-menu:action", { action: "selectAll", sessionId: payload?.sessionId }),
		},
		{ type: "separator" },
		{
			label: "Find",
			accelerator: "CmdOrCtrl+F",
			click: () => event.sender.send("context-menu:action", { action: "find", sessionId: payload?.sessionId }),
		},
		{
			label: "Clear Terminal",
			click: () => event.sender.send("context-menu:action", { action: "clear", sessionId: payload?.sessionId }),
		},
	]);

	menu.popup({ window: win });
});

app.whenReady().then(() => {
	if (process.platform !== "darwin") {
		Menu.setApplicationMenu(null);
	}

	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	for (const session of sessions.values()) {
		closeTrackedSession(session);
	}
	sessions.clear();

	if (process.platform !== "darwin") app.quit();
});
