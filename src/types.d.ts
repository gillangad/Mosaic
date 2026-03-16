import type { TerminalExitEvent, TerminalSessionMeta, WorkspaceSelection } from "./core/models";

interface DirectoryEntry {
	name: string;
	path: string;
	relativePath: string;
	isDirectory: boolean;
	extension: string;
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
			readDirectory: (workspacePath: string, directoryPath: string) => Promise<DirectoryEntry[]>;
			readFile: (filePath: string) => Promise<string>;
			readFileBase64: (filePath: string) => Promise<string>;
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
