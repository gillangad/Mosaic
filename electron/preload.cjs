const { contextBridge, ipcRenderer } = require("electron");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");

function createSubscriptionId() {
	if (typeof randomUUID === "function") return randomUUID();
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

contextBridge.exposeInMainWorld("mosaic", {
	createTerminal: (options) => ipcRenderer.invoke("terminal:create", options),
	writeTerminal: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
	resizeTerminal: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
	closeTerminal: (id) => ipcRenderer.invoke("terminal:close", id),
	pickWorkspaceDirectory: () => ipcRenderer.invoke("workspace:pickDirectory"),
	inspectWorkspace: (directoryPath) => ipcRenderer.invoke("workspace:inspect", directoryPath),
	gitStatus: (directoryPath, force = false) => ipcRenderer.invoke("git:status", { directoryPath, force }),
	gitBranches: (directoryPath) => ipcRenderer.invoke("git:branches", directoryPath),
	gitLog: (directoryPath, limit = 30) => ipcRenderer.invoke("git:log", { directoryPath, limit }),
	gitDiff: (directoryPath, filePath, cached = false) => ipcRenderer.invoke("git:diff", { directoryPath, filePath, cached }),
	gitShowCommit: (directoryPath, hash) => ipcRenderer.invoke("git:showCommit", { directoryPath, hash }),
	gitStage: (directoryPath, filePath) => ipcRenderer.invoke("git:stage", { directoryPath, filePath }),
	gitUnstage: (directoryPath, filePath) => ipcRenderer.invoke("git:unstage", { directoryPath, filePath }),
	gitCheckout: (directoryPath, branch) => ipcRenderer.invoke("git:checkout", { directoryPath, branch }),
	gitCommit: (directoryPath, message, amend = false) => ipcRenderer.invoke("git:commit", { directoryPath, message, amend }),
	gitPush: (directoryPath) => ipcRenderer.invoke("git:push", directoryPath),
	gitPull: (directoryPath) => ipcRenderer.invoke("git:pull", directoryPath),
	gitStashList: (directoryPath) => ipcRenderer.invoke("git:stashList", directoryPath),
	gitStashApply: (directoryPath, ref) => ipcRenderer.invoke("git:stashApply", { directoryPath, ref }),
	gitStashDrop: (directoryPath, ref) => ipcRenderer.invoke("git:stashDrop", { directoryPath, ref }),
	readDirectory: (workspacePath, directoryPath) => ipcRenderer.invoke("fs:readDir", { workspacePath, directoryPath }),
	readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
	getFileInfo: (filePath) => ipcRenderer.invoke("fs:getFileInfo", filePath),
	filePathToUrl: (filePath) => pathToFileURL(filePath).toString(),
	writeFile: (filePath, contents) => ipcRenderer.invoke("fs:writeFile", { filePath, contents }),
	getBrowserCdpTarget: (webContentsId, url, title) => ipcRenderer.invoke("browser:getCdpTarget", { webContentsId, url, title }),
	updateTitleBarOverlay: (payload) => ipcRenderer.invoke("window:updateTitleBarOverlay", payload),
	subscribeTerminal: (id, handlers) => {
		const subscriptionId = createSubscriptionId();
		const dataChannel = `terminal:data:${id}`;
		const exitChannel = `terminal:exit:${id}`;
		const dataListener = (_event, data) => handlers.onData(data);
		const exitListener = (_event, data) => handlers.onExit(data);

		ipcRenderer.on(dataChannel, dataListener);
		ipcRenderer.on(exitChannel, exitListener);
		ipcRenderer.send("terminal:subscribe", { id, subscriptionId });

		return () => {
			ipcRenderer.send("terminal:unsubscribe", { id, subscriptionId });
			ipcRenderer.removeListener(dataChannel, dataListener);
			ipcRenderer.removeListener(exitChannel, exitListener);
		};
	},
	showTerminalContextMenu: (sessionId) => {
		ipcRenderer.send("context-menu:terminal", { sessionId });
	},
	onContextMenuAction: (callback) => {
		const listener = (_event, data) => callback(data);
		ipcRenderer.on("context-menu:action", listener);
		return () => ipcRenderer.removeListener("context-menu:action", listener);
	},
});
