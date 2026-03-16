import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import os from "node:os";
import pty from "node-pty";
import ignore from "ignore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const sessions = new Map();
const GIT_COMMAND_TIMEOUT_MS = 4_000;
const GIT_STATUS_CACHE_TTL_MS = 15_000;
const gitStatusCache = new Map();
let defaultWindowsShellCache = null;
let terminalSpawnEnvCache = null;

function getEmptyGitStatus() {
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

function parseGitPorcelainStatus(statusStdout) {
	const lines = statusStdout.split(/\r?\n/).filter(Boolean);
	const branchLine = lines.find((line) => line.startsWith("# branch.head "));
	const aheadBehindLine = lines.find((line) => line.startsWith("# branch.ab "));
	const branchName = branchLine?.replace("# branch.head ", "").trim() || null;
	const statusLines = lines.filter((line) => !line.startsWith("#"));
	const files = statusLines.map((line) => {
		const x = line[0] ?? " ";
		const y = line[1] ?? " ";
		const remainder = line.slice(3).trim();
		const [fromPath, toPath] = remainder.split(" -> ");
		const pathValue = (toPath || fromPath || "").trim();
		const statusCode = x !== " " && x !== "?" ? x : y;
		return {
			path: pathValue,
			originalPath: toPath ? fromPath.trim() : null,
			status: statusCode === "?" ? "U" : statusCode || "M",
			staged: x !== " " && x !== "?",
			unstaged: y !== " " && y !== "?",
			raw: line,
		};
	});

	let ahead = 0;
	let behind = 0;
	if (aheadBehindLine) {
		const match = aheadBehindLine.match(/\+(\d+)\s+\-(\d+)/);
		if (match) {
			ahead = Number(match[1]);
			behind = Number(match[2]);
		}
	}

	const dirty = files.length > 0;
	const parts = [branchName && branchName !== "(detached)" ? branchName : "detached"];
	parts.push(dirty ? `${files.length} change${files.length === 1 ? "" : "s"}` : "clean");
	if (ahead) parts.push(`+${ahead}`);
	if (behind) parts.push(`-${behind}`);

	return {
		branchName,
		ahead,
		behind,
		dirty,
		summary: parts.join(" • "),
		files,
	};
}

function clearGitStatusCacheFor(directoryPath) {
	const cacheKey = path.resolve(directoryPath);
	gitStatusCache.delete(cacheKey);
}

function normalizeGitDirectoryPath(directoryPath) {
	if (typeof directoryPath !== "string" || directoryPath.trim().length === 0) {
		throw new Error("directoryPath is required");
	}
	return directoryPath;
}

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

app.commandLine.appendSwitch("remote-debugging-port", "9222");

function resolveWindowsDefaultShell() {
	if (defaultWindowsShellCache) return defaultWindowsShellCache;

	const wherePwsh = spawnSync("where.exe", ["pwsh.exe"], {
		encoding: "utf8",
		windowsHide: true,
	});
	if (wherePwsh.status === 0) {
		const onPath = wherePwsh.stdout.split(/\r?\n/).find(Boolean)?.trim();
		defaultWindowsShellCache = onPath || "pwsh.exe";
		return defaultWindowsShellCache;
	}

	const candidates = [
		process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "PowerShell", "7", "pwsh.exe") : null,
		process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "PowerShell", "7", "pwsh.exe") : null,
		process.env.ProgramW6432 ? path.join(process.env.ProgramW6432, "PowerShell", "7", "pwsh.exe") : null,
	].filter(Boolean);

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			defaultWindowsShellCache = candidate;
			return defaultWindowsShellCache;
		}
	}

	defaultWindowsShellCache = process.env.ComSpec || "cmd.exe";
	return defaultWindowsShellCache;
}

function getDefaultShell() {
	if (process.platform === "win32") {
		return resolveWindowsDefaultShell();
	}

	return process.env.SHELL || "/bin/bash";
}

function getTerminalSpawnEnv() {
	if (terminalSpawnEnvCache) return terminalSpawnEnvCache;
	const localBinPath = path.join(__dirname, "..", "node_modules", ".bin");
	const basePath = process.env.PATH ?? process.env.Path ?? "";
	const mergedPath = [localBinPath, basePath].filter(Boolean).join(path.delimiter);
	terminalSpawnEnvCache = {
		...process.env,
		PATH: mergedPath,
		Path: mergedPath,
	};
	return terminalSpawnEnvCache;
}

function convertWindowsWslUncToLinuxPath(directoryPath) {
	if (process.platform !== "win32") return null;
	if (typeof directoryPath !== "string") return null;
	const match = directoryPath.match(/^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i);
	if (!match) return null;
	const distro = match[1];
	const remainder = match[2] ?? "";
	const normalizedRemainder = remainder.replace(/\\+/g, "/").replace(/^\/+/, "");
	const linuxPath = `/${normalizedRemainder}`.replace(/\/+/g, "/");
	return {
		distro,
		linuxPath: linuxPath === "/" ? "/" : linuxPath.replace(/\/$/, "") || "/",
	};
}

async function runGit(args, directoryPath) {
	const wslPath = convertWindowsWslUncToLinuxPath(directoryPath);
	if (wslPath) {
		return execFileAsync("wsl.exe", ["--distribution", wslPath.distro, "--cd", wslPath.linuxPath, "git", ...args], {
			timeout: GIT_COMMAND_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
			windowsHide: true,
		});
	}

	return execFileAsync("git", args, {
		cwd: directoryPath,
		timeout: GIT_COMMAND_TIMEOUT_MS,
		maxBuffer: 1024 * 1024,
		windowsHide: true,
	});
}

async function readWorkspaceGitStatus(directoryPath, options = {}) {
	const cacheKey = path.resolve(directoryPath);
	const now = Date.now();
	const cached = gitStatusCache.get(cacheKey);
	if (!options.force) {
		if (cached?.value && cached.expiresAt > now) return cached.value;
		if (cached?.promise) return cached.promise;
	}

	const promise = (async () => {
		try {
			const { stdout: rootStdout } = await runGit(["rev-parse", "--show-toplevel"], directoryPath);
			const rootPath = rootStdout.trim();
			const { stdout: statusStdout } = await runGit(["status", "--porcelain=v1", "--branch"], directoryPath);
			const parsed = parseGitPorcelainStatus(statusStdout);
			return {
				isRepo: true,
				branch: parsed.branchName,
				summary: parsed.summary,
				dirty: parsed.dirty,
				ahead: parsed.ahead,
				behind: parsed.behind,
				changeCount: parsed.files.length,
				rootPath,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[git] failed for "${directoryPath}":`, message);
			return getEmptyGitStatus();
		}
	})();

	gitStatusCache.set(cacheKey, {
		value: cached?.value ?? null,
		expiresAt: cached?.expiresAt ?? 0,
		promise,
	});

	const value = await promise;
	gitStatusCache.set(cacheKey, {
		value,
		expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS,
		promise: null,
	});
	return value;
}

async function readWorkspaceGitDetails(directoryPath, options = {}) {
	const safeDirectoryPath = normalizeGitDirectoryPath(directoryPath);
	try {
		const { stdout: rootStdout } = await runGit(["rev-parse", "--show-toplevel"], safeDirectoryPath);
		const rootPath = rootStdout.trim();
		const { stdout: statusStdout } = await runGit(["status", "--porcelain=v1", "--branch"], safeDirectoryPath);
		const parsed = parseGitPorcelainStatus(statusStdout);
		const value = {
			isRepo: true,
			branch: parsed.branchName,
			summary: parsed.summary,
			dirty: parsed.dirty,
			ahead: parsed.ahead,
			behind: parsed.behind,
			changeCount: parsed.files.length,
			rootPath,
			files: parsed.files,
		};
		if (options.force) {
			clearGitStatusCacheFor(safeDirectoryPath);
		}
		return value;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[git] status details failed for "${safeDirectoryPath}":`, message);
		return {
			...getEmptyGitStatus(),
			files: [],
		};
	}
}

async function readWorkspaceGitLog(directoryPath, limit = 30) {
	const safeDirectoryPath = normalizeGitDirectoryPath(directoryPath);
	const safeLimit = Math.max(1, Math.min(200, Number.isFinite(limit) ? Number(limit) : 30));
	const { stdout } = await runGit([
		"log",
		`-n`,
		String(safeLimit),
		"--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s",
	], safeDirectoryPath);
	return stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const [hash, shortHash, author, relativeTime, subject] = line.split("\u001f");
			return {
				hash,
				shortHash,
				author,
				relativeTime,
				subject,
			};
		});
}

async function readWorkspaceGitBranches(directoryPath) {
	const safeDirectoryPath = normalizeGitDirectoryPath(directoryPath);
	const { stdout } = await runGit([
		"branch",
		"--format=%(refname:short)%x1f%(HEAD)",
	], safeDirectoryPath);
	return stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const [name, headMarker] = line.split("\u001f");
			return {
				name,
				current: (headMarker || "").trim() === "*",
			};
		});
}

async function readWorkspaceGitStashes(directoryPath) {
	const safeDirectoryPath = normalizeGitDirectoryPath(directoryPath);
	const { stdout } = await runGit([
		"stash",
		"list",
		"--pretty=format:%gd%x1f%gs%x1f%cr",
	], safeDirectoryPath);
	return stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const [ref, message, relativeTime] = line.split("\u001f");
			return {
				ref,
				message,
				relativeTime,
			};
		});
}

async function runWorkspaceGitMutation(directoryPath, args) {
	const safeDirectoryPath = normalizeGitDirectoryPath(directoryPath);
	const result = await runGit(args, safeDirectoryPath);
	clearGitStatusCacheFor(safeDirectoryPath);
	return result;
}

async function inspectWorkspace(directoryPath, options = {}) {
	return {
		path: directoryPath,
		git: await readWorkspaceGitStatus(directoryPath, options),
	};
}

const FILE_TREE_EXCLUDED_SEGMENTS = new Set(["node_modules", ".git", "dist"]);
const workspaceIgnoreMatcherCache = new Map();

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
	const cacheKey = path.resolve(workspacePath);
	const cached = workspaceIgnoreMatcherCache.get(cacheKey);
	if (cached) return cached;

	const matcherPromise = (async () => {
		const matcher = ignore();
		try {
			const gitignorePath = path.join(workspacePath, ".gitignore");
			const raw = await readFile(gitignorePath, "utf8");
			matcher.add(raw);
		} catch {
			// No .gitignore found.
		}
		return matcher;
	})();

	workspaceIgnoreMatcherCache.set(cacheKey, matcherPromise);
	return matcherPromise;
}

function isHardExcluded(relativePath) {
	const segments = normalizeRelativePath(relativePath).split("/").filter(Boolean);
	return segments.some((segment) => FILE_TREE_EXCLUDED_SEGMENTS.has(segment));
}

function isIgnoredPath(matcher, relativePath, isDirectory) {
	if (!relativePath) return false;
	if (isHardExcluded(relativePath)) return true;
	if (!matcher) return false;
	const normalizedPath = normalizeRelativePath(relativePath);
	if (matcher.ignores(normalizedPath)) return true;
	return isDirectory ? matcher.ignores(`${normalizedPath}/`) : false;
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

	const spawnOptions = {
		name: "xterm-256color",
		env: getTerminalSpawnEnv(),
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
ipcMain.handle("git:status", async (_event, payload) => {
	const directoryPath = typeof payload?.directoryPath === "string" ? payload.directoryPath : payload;
	const force = Boolean(payload?.force);
	return readWorkspaceGitDetails(directoryPath, { force });
});
ipcMain.handle("git:branches", async (_event, directoryPath) => readWorkspaceGitBranches(directoryPath));
ipcMain.handle("git:log", async (_event, payload) => {
	const directoryPath = typeof payload?.directoryPath === "string" ? payload.directoryPath : payload;
	const limit = Number(payload?.limit ?? 30);
	return readWorkspaceGitLog(directoryPath, limit);
});
ipcMain.handle("git:diff", async (_event, payload) => {
	const directoryPath = normalizeGitDirectoryPath(payload?.directoryPath);
	const filePath = typeof payload?.filePath === "string" ? payload.filePath : "";
	const cached = Boolean(payload?.cached);
	if (!filePath) throw new Error("filePath is required");
	const args = cached ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
	const { stdout } = await runGit(args, directoryPath);
	return stdout;
});
ipcMain.handle("git:showCommit", async (_event, payload) => {
	const directoryPath = normalizeGitDirectoryPath(payload?.directoryPath);
	const hash = typeof payload?.hash === "string" ? payload.hash : "";
	if (!hash) throw new Error("hash is required");
	const { stdout } = await runGit(["show", "--format=", "--no-color", hash], directoryPath);
	return stdout;
});
ipcMain.handle("git:stage", async (_event, payload) => {
	const directoryPath = normalizeGitDirectoryPath(payload?.directoryPath);
	const filePath = typeof payload?.filePath === "string" ? payload.filePath : "";
	if (!filePath) throw new Error("filePath is required");
	await runWorkspaceGitMutation(directoryPath, ["add", "--", filePath]);
	return readWorkspaceGitDetails(directoryPath, { force: true });
});
ipcMain.handle("git:unstage", async (_event, payload) => {
	const directoryPath = normalizeGitDirectoryPath(payload?.directoryPath);
	const filePath = typeof payload?.filePath === "string" ? payload.filePath : "";
	if (!filePath) throw new Error("filePath is required");
	await runWorkspaceGitMutation(directoryPath, ["reset", "HEAD", "--", filePath]);
	return readWorkspaceGitDetails(directoryPath, { force: true });
});
ipcMain.handle("git:checkout", async (_event, payload) => {
	const directoryPath = normalizeGitDirectoryPath(payload?.directoryPath);
	const branch = typeof payload?.branch === "string" ? payload.branch.trim() : "";
	if (!branch) throw new Error("branch is required");
	await runWorkspaceGitMutation(directoryPath, ["checkout", branch]);
	return readWorkspaceGitDetails(directoryPath, { force: true });
});
ipcMain.handle("git:commit", async (_event, payload) => {
	const directoryPath = normalizeGitDirectoryPath(payload?.directoryPath);
	const message = typeof payload?.message === "string" ? payload.message.trim() : "";
	const amend = Boolean(payload?.amend);
	if (!message && !amend) throw new Error("commit message is required");
	if (amend) {
		const args = message ? ["commit", "--amend", "-m", message] : ["commit", "--amend", "--no-edit"];
		await runWorkspaceGitMutation(directoryPath, args);
	} else {
		await runWorkspaceGitMutation(directoryPath, ["commit", "-m", message]);
	}
	return readWorkspaceGitDetails(directoryPath, { force: true });
});
ipcMain.handle("git:push", async (_event, directoryPath) => {
	await runWorkspaceGitMutation(directoryPath, ["push"]);
	return readWorkspaceGitDetails(directoryPath, { force: true });
});
ipcMain.handle("git:pull", async (_event, directoryPath) => {
	await runWorkspaceGitMutation(directoryPath, ["pull", "--ff-only"]);
	return readWorkspaceGitDetails(directoryPath, { force: true });
});
ipcMain.handle("git:stashList", async (_event, directoryPath) => readWorkspaceGitStashes(directoryPath));
ipcMain.handle("git:stashApply", async (_event, payload) => {
	const directoryPath = normalizeGitDirectoryPath(payload?.directoryPath);
	const ref = typeof payload?.ref === "string" ? payload.ref : "";
	if (!ref) throw new Error("stash ref is required");
	await runWorkspaceGitMutation(directoryPath, ["stash", "apply", ref]);
	return readWorkspaceGitStashes(directoryPath);
});
ipcMain.handle("git:stashDrop", async (_event, payload) => {
	const directoryPath = normalizeGitDirectoryPath(payload?.directoryPath);
	const ref = typeof payload?.ref === "string" ? payload.ref : "";
	if (!ref) throw new Error("stash ref is required");
	await runWorkspaceGitMutation(directoryPath, ["stash", "drop", ref]);
	return readWorkspaceGitStashes(directoryPath);
});

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

ipcMain.handle("fs:getFileInfo", async (_event, filePath) => {
	if (typeof filePath !== "string" || filePath.length === 0) {
		throw new Error("filePath is required.");
	}
	const fileStats = await stat(filePath);
	return {
		size: fileStats.size,
		mtimeMs: fileStats.mtimeMs,
	};
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

ipcMain.on("terminal:write", (_event, payload) => {
	const session = sessions.get(payload?.id);
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
