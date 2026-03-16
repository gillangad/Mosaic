import type { TerminalExitEvent, TerminalSessionMeta, WorkspaceSelection } from "./core/models";

interface DirectoryEntry {
	name: string;
	path: string;
	relativePath: string;
	isDirectory: boolean;
	extension: string;
}

interface GitFileEntry {
	path: string;
	originalPath: string | null;
	status: string;
	staged: boolean;
	unstaged: boolean;
	raw: string;
}

interface GitStatusDetails {
	isRepo: boolean;
	branch: string | null;
	summary: string;
	dirty: boolean;
	ahead: number;
	behind: number;
	changeCount: number;
	rootPath: string | null;
	files: GitFileEntry[];
}

interface GitBranchEntry {
	name: string;
	current: boolean;
}

interface GitCommitEntry {
	hash: string;
	shortHash: string;
	author: string;
	relativeTime: string;
	subject: string;
}

interface GitStashEntry {
	ref: string;
	message: string;
	relativeTime: string;
}

declare global {
	namespace JSX {
		interface IntrinsicElements {
			webview: import("react").DetailedHTMLProps<import("react").HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
		}
	}

	interface Window {
		mosaic: {
			createTerminal: (options?: { cwd?: string }) => Promise<TerminalSessionMeta>;
			writeTerminal: (id: string, data: string) => Promise<void>;
			resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>;
			closeTerminal: (id: string) => Promise<void>;
			pickWorkspaceDirectory: () => Promise<WorkspaceSelection | null>;
			inspectWorkspace: (directoryPath: string) => Promise<WorkspaceSelection>;
			gitStatus: (directoryPath: string, force?: boolean) => Promise<GitStatusDetails>;
			gitBranches: (directoryPath: string) => Promise<GitBranchEntry[]>;
			gitLog: (directoryPath: string, limit?: number) => Promise<GitCommitEntry[]>;
			gitDiff: (directoryPath: string, filePath: string, cached?: boolean) => Promise<string>;
			gitShowCommit: (directoryPath: string, hash: string) => Promise<string>;
			gitStage: (directoryPath: string, filePath: string) => Promise<GitStatusDetails>;
			gitUnstage: (directoryPath: string, filePath: string) => Promise<GitStatusDetails>;
			gitCheckout: (directoryPath: string, branch: string) => Promise<GitStatusDetails>;
			gitCommit: (directoryPath: string, message: string, amend?: boolean) => Promise<GitStatusDetails>;
			gitPush: (directoryPath: string) => Promise<GitStatusDetails>;
			gitPull: (directoryPath: string) => Promise<GitStatusDetails>;
			gitStashList: (directoryPath: string) => Promise<GitStashEntry[]>;
			gitStashApply: (directoryPath: string, ref: string) => Promise<GitStashEntry[]>;
			gitStashDrop: (directoryPath: string, ref: string) => Promise<GitStashEntry[]>;
			readDirectory: (workspacePath: string, directoryPath: string) => Promise<DirectoryEntry[]>;
			readFile: (filePath: string) => Promise<string>;
			getFileInfo: (filePath: string) => Promise<{ size: number; mtimeMs: number }>;
			filePathToUrl: (filePath: string) => string;
			writeFile: (filePath: string, contents: string) => Promise<void>;
			getBrowserCdpTarget: (
				webContentsId: number,
				url?: string,
				title?: string,
			) => Promise<{ id: string; webSocketDebuggerUrl: string; url: string; title: string } | null>;
			updateTitleBarOverlay: (payload: { backgroundColor: string; overlayColor: string; symbolColor: string }) => Promise<void>;
			subscribeTerminal: (
				id: string,
				handlers: {
					onData: (data: string) => void;
					onExit: (data: TerminalExitEvent) => void;
				},
			) => () => void;
			showTerminalContextMenu: (sessionId: string | null) => void;
			onContextMenuAction: (callback: (data: { action: string; sessionId: string | null }) => void) => () => void;
		};
	}
}

export {};
