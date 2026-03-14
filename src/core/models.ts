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
	git: WorkspaceGitStatus;
	layout: LayoutNode;
	focusedPaneId?: string;
}

export interface TerminalTabModel {
	id: string;
	title: string;
	status: PaneStatus;
	shellLabel?: string;
	message?: string;
}

export interface PaneModel {
	id: string;
	tabs: TerminalTabModel[];
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
