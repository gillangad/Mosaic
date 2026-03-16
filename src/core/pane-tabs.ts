import type { BrowserTabModel, EditorTabModel, FileTreeTabModel, ImageTabModel, MarkdownTabModel, PaneStatus, PaneTabModel, PdfTabModel, TerminalTabModel } from "./models";
import { getWorkspaceLeafName } from "./workspaces";

function getLeafName(value: string) {
	const normalized = value.replace(/[\\/]+$/, "");
	const parts = normalized.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? normalized;
}

function getExtension(value: string) {
	const leaf = getLeafName(value);
	const dotIndex = leaf.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === leaf.length - 1) return "";
	return leaf.slice(dotIndex + 1).toLowerCase();
}

export function normalizeFilePath(value: string) {
	return value.replace(/\\/g, "/");
}

export function getFileExtension(value: string) {
	return getExtension(value);
}

export function isMarkdownPath(value: string) {
	const extension = getExtension(value);
	return extension === "md" || extension === "markdown";
}

export function isImagePath(value: string) {
	const extension = getExtension(value);
	return ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(extension);
}

export function isPdfPath(value: string) {
	return getExtension(value) === "pdf";
}

export function getMonacoLanguage(filePath: string) {
	const extension = getExtension(filePath);
	const map: Record<string, string> = {
		js: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		ts: "typescript",
		tsx: "typescript",
		jsx: "javascript",
		json: "json",
		css: "css",
		scss: "scss",
		less: "less",
		html: "html",
		xml: "xml",
		yml: "yaml",
		yaml: "yaml",
		py: "python",
		rs: "rust",
		go: "go",
		java: "java",
		php: "php",
		rb: "ruby",
		sh: "shell",
		bash: "shell",
		zsh: "shell",
		ps1: "powershell",
		sql: "sql",
		graphql: "graphql",
		gql: "graphql",
		md: "markdown",
	};
	return map[extension] ?? "plaintext";
}

export function createTerminalTab(workspacePath: string): TerminalTabModel {
	return {
		id: crypto.randomUUID(),
		kind: "terminal",
		title: getWorkspaceLeafName(workspacePath),
		status: "starting",
		message: "Launching terminal...",
	};
}

export function createFileTreeTab(workspacePath: string): FileTreeTabModel {
	return {
		id: crypto.randomUUID(),
		kind: "fileTree",
		title: "Files",
		rootPath: workspacePath,
	};
}

export function createEditorTab(filePath: string, content: string): EditorTabModel {
	return {
		id: crypto.randomUUID(),
		kind: "editor",
		title: getLeafName(filePath),
		filePath,
		language: getMonacoLanguage(filePath),
		content,
		savedContent: content,
		dirty: false,
	};
}

export function createMarkdownTab(filePath: string, content: string): MarkdownTabModel {
	return {
		id: crypto.randomUUID(),
		kind: "markdown",
		title: getLeafName(filePath),
		filePath,
		content,
		savedContent: content,
		dirty: false,
	};
}

export function createImageTab(filePath: string): ImageTabModel {
	return {
		id: crypto.randomUUID(),
		kind: "image",
		title: getLeafName(filePath),
		filePath,
	};
}

export function createPdfTab(filePath: string): PdfTabModel {
	return {
		id: crypto.randomUUID(),
		kind: "pdf",
		title: getLeafName(filePath),
		filePath,
	};
}

export function createBrowserTab(initialUrl = "about:blank"): BrowserTabModel {
	return {
		id: crypto.randomUUID(),
		kind: "browser",
		title: "Browser",
		url: initialUrl,
	};
}

export function isTerminalTab(tab: PaneTabModel): tab is TerminalTabModel {
	return tab.kind === "terminal";
}

export function isEditorTab(tab: PaneTabModel): tab is EditorTabModel {
	return tab.kind === "editor";
}

export function isMarkdownTab(tab: PaneTabModel): tab is MarkdownTabModel {
	return tab.kind === "markdown";
}

export function isFileTreeTab(tab: PaneTabModel): tab is FileTreeTabModel {
	return tab.kind === "fileTree";
}

export function getTabStatus(tab: PaneTabModel): PaneStatus {
	if (tab.kind === "terminal") return tab.status;
	if (tab.kind === "editor" && tab.dirty) return "busy";
	if (tab.kind === "markdown" && tab.dirty) return "busy";
	return "idle";
}
