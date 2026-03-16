const { contextBridge, ipcRenderer } = require("electron");
const { randomUUID } = require("node:crypto");

function createSubscriptionId() {
	if (typeof randomUUID === "function") return randomUUID();
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

contextBridge.exposeInMainWorld("mosaic", {
	createTerminal: (options) => ipcRenderer.invoke("terminal:create", options),
	writeTerminal: (id, data) => ipcRenderer.invoke("terminal:write", { id, data }),
	resizeTerminal: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
	closeTerminal: (id) => ipcRenderer.invoke("terminal:close", id),
	pickWorkspaceDirectory: () => ipcRenderer.invoke("workspace:pickDirectory"),
	inspectWorkspace: (directoryPath) => ipcRenderer.invoke("workspace:inspect", directoryPath),
	readDirectory: (workspacePath, directoryPath) => ipcRenderer.invoke("fs:readDir", { workspacePath, directoryPath }),
	readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
	readFileBase64: (filePath) => ipcRenderer.invoke("fs:readFileBase64", filePath),
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
