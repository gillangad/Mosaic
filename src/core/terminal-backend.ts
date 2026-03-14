import type { PaneStatus, TerminalExitEvent, TerminalSessionMeta, TerminalSessionSnapshot } from "./models";

export interface TerminalStreamHandlers {
	onData: (data: string) => void;
	onExit: (event: TerminalExitEvent) => void;
	onStatusChange?: (status: PaneStatus, message?: string) => void;
}

export interface TerminalBackend {
	readonly kind: string;
	isAvailable(): boolean;
	createSession(options?: { cwd?: string }): Promise<TerminalSessionMeta>;
	write(sessionId: string, data: string): Promise<void>;
	resize(sessionId: string, cols: number, rows: number): Promise<void>;
	close(sessionId: string): Promise<void>;
	subscribe(sessionId: string, handlers: TerminalStreamHandlers): () => void;
	getUnavailableReason(): string;
	createUnavailableSnapshot(): TerminalSessionSnapshot;
}
