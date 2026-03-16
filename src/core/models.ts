export type PaneStatus = "starting" | "busy" | "idle" | "exited" | "unavailable";

export interface WorkspaceGitStatus {
	isRepo: boolean;
	branch: string | null;
	summary: string;
	dirty: boolean;
	ahead: number;
	behind: number;
	changeCount: number;
	rootPath: string | null;
}

export interface WorkspaceModel {
	id: string;
	path: string;
	customName?: string;
	accentColor?: string;
	git: WorkspaceGitStatus;
	layout: LayoutNode;
	focusedPaneId?: string;
}

interface PaneTabBase {
	id: string;
	title: string;
	kind: "terminal" | "fileTree" | "editor" | "markdown";
}

export interface TerminalTabModel extends PaneTabBase {
	kind: "terminal";
	status: PaneStatus;
	shellLabel?: string;
	message?: string;
}

export interface FileTreeTabModel extends PaneTabBase {
	kind: "fileTree";
	rootPath: string;
}

export interface EditorTabModel extends PaneTabBase {
	kind: "editor";
	filePath: string;
	language: string;
	content: string;
	savedContent: string;
	dirty: boolean;
	message?: string;
}

export interface MarkdownTabModel extends PaneTabBase {
	kind: "markdown";
	filePath: string;
	content: string;
}

export type PaneTabModel = TerminalTabModel | FileTreeTabModel | EditorTabModel | MarkdownTabModel;

export interface PaneModel {
	id: string;
	tabs: PaneTabModel[];
	activeTabId: string;
}

export type SplitDirection = "horizontal" | "vertical";

export interface PaneLayoutNode {
	type: "pane";
	id: string;
	pane: PaneModel;
	widthUnits?: number;
}

export interface SplitLayoutNode {
	type: "split";
	id: string;
	direction: SplitDirection;
	ratio: number;
	first: LayoutNode;
	second: LayoutNode;
	widthUnits?: number;
}

export type LayoutNode = PaneLayoutNode | SplitLayoutNode;

export interface TerminalSessionMeta {
	id: string;
	shell: string;
	cwd: string;
}

export interface WorkspaceSelection {
	path: string;
	git: WorkspaceGitStatus;
}

export interface TerminalExitEvent {
	exitCode: number;
	signal?: number;
}

export interface TerminalSessionSnapshot {
	id: string;
	shellLabel: string;
	status: PaneStatus;
	message: string;
}
