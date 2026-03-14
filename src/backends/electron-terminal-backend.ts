import type { PaneStatus, TerminalSessionMeta, TerminalSessionSnapshot } from "../core/models";
import type { TerminalBackend, TerminalStreamHandlers } from "../core/terminal-backend";
import { normalizeShellLabel } from "../core/terminal-utils";

class ElectronTerminalBackend implements TerminalBackend {
	readonly kind = "electron-node-pty";

	isAvailable() {
		return typeof window !== "undefined" && typeof window.mosaic !== "undefined";
	}

	async createSession(options?: { cwd?: string }): Promise<TerminalSessionMeta> {
		if (!this.isAvailable()) {
			throw new Error(this.getUnavailableReason());
		}

		return window.mosaic.createTerminal(options);
	}

	async write(sessionId: string, data: string) {
		if (!this.isAvailable()) return;
		await window.mosaic.writeTerminal(sessionId, data);
	}

	async resize(sessionId: string, cols: number, rows: number) {
		if (!this.isAvailable()) return;
		await window.mosaic.resizeTerminal(sessionId, cols, rows);
	}

	async close(sessionId: string) {
		if (!this.isAvailable()) return;
		await window.mosaic.closeTerminal(sessionId);
	}

	subscribe(sessionId: string, handlers: TerminalStreamHandlers) {
		if (!this.isAvailable()) {
			handlers.onStatusChange?.("unavailable", this.getUnavailableReason());
			return () => {};
		}

		handlers.onStatusChange?.("idle", "Connected");
		return window.mosaic.subscribeTerminal(sessionId, {
			onData: handlers.onData,
			onExit: (event) => {
				handlers.onStatusChange?.("exited", "Process exited");
				handlers.onExit(event);
			},
		});
	}

	getUnavailableReason() {
		return "Terminal bridge is unavailable in this window.";
	}

	createUnavailableSnapshot(): TerminalSessionSnapshot {
		return {
			id: "unavailable",
			shellLabel: "offline",
			status: "unavailable",
			message: this.getUnavailableReason(),
		};
	}
}

export const electronTerminalBackend = new ElectronTerminalBackend();
