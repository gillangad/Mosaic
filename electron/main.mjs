import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import os from "node:os";
import pty from "node-pty";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const sessions = new Map();

if (process.platform === "linux") {
	app.disableHardwareAcceleration();
}

function getDefaultShell() {
	if (process.platform === "win32") {
		return process.env.ComSpec || "powershell.exe";
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

function createWindow() {
	const win = new BrowserWindow({
		width: 1480,
		height: 920,
		minWidth: 1100,
		minHeight: 720,
		backgroundColor: "#0b0d12",
		autoHideMenuBar: true,
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
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

	let proc;
	try {
		proc = pty.spawn(shell, [], {
			name: "xterm-256color",
			cwd,
			env: process.env,
			cols: 120,
			rows: 36,
		});
	} catch {
		proc = pty.spawn(shell, [], {
			name: "xterm-256color",
			cwd: os.homedir(),
			env: process.env,
			cols: 120,
			rows: 36,
		});
	}

	sessions.set(id, proc);
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

ipcMain.handle("terminal:write", (_event, payload) => {
	const proc = sessions.get(payload.id);
	if (proc) proc.write(payload.data);
});

ipcMain.handle("terminal:resize", (_event, payload) => {
	const proc = sessions.get(payload.id);
	if (proc) proc.resize(payload.cols, payload.rows);
});

ipcMain.handle("terminal:close", (_event, id) => {
	const proc = sessions.get(id);
	if (!proc) return;
	proc.kill();
	sessions.delete(id);
});

ipcMain.on("terminal:subscribe", (event, id) => {
	const proc = sessions.get(id);
	if (!proc) return;

	const sendData = (data) => {
		event.sender.send(`terminal:data:${id}`, data);
	};

	const sendExit = (eventData) => {
		event.sender.send(`terminal:exit:${id}`, eventData);
		cleanup();
		sessions.delete(id);
	};

	const dataDisposable = proc.onData(sendData);
	const exitDisposable = proc.onExit(sendExit);

		const cleanup = () => {
			dataDisposable.dispose();
			exitDisposable.dispose();
			ipcMain.removeListener(`terminal:unsubscribe:${id}`, cleanup);
		};

		ipcMain.once(`terminal:unsubscribe:${id}`, cleanup);
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
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	for (const proc of sessions.values()) proc.kill();
	sessions.clear();

	if (process.platform !== "darwin") app.quit();
});
