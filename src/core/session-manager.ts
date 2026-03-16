import type { TerminalBackend } from "./terminal-backend";
import { normalizeShellLabel } from "./terminal-utils";

const MAX_SNAPSHOT_CHARS = 150_000;

function trimSnapshot(snapshot: string) {
	if (snapshot.length <= MAX_SNAPSHOT_CHARS) return snapshot;
	return snapshot.slice(snapshot.length - MAX_SNAPSHOT_CHARS);
}

export class SessionManager {
	private readonly tabToSession = new Map<string, string>();
	private readonly shellLabels = new Map<string, string>();
	private readonly sessionSnapshots = new Map<string, string>();
	private readonly pendingSessionCreates = new Map<string, Promise<string>>();
	private readonly closeRequestedWhilePending = new Set<string>();

	constructor(private readonly backend: TerminalBackend) {}

	async ensureSession(tabId: string, cwd: string): Promise<string> {
		this.closeRequestedWhilePending.delete(tabId);
		const existingSessionId = this.tabToSession.get(tabId);
		if (existingSessionId) return existingSessionId;

		const pending = this.pendingSessionCreates.get(tabId);
		if (pending) return pending;

		const createPromise = this.backend
			.createSession({ cwd })
			.then((session) => {
				this.pendingSessionCreates.delete(tabId);
				if (this.closeRequestedWhilePending.has(tabId)) {
					this.closeRequestedWhilePending.delete(tabId);
					void this.backend.close(session.id);
					return session.id;
				}
				this.tabToSession.set(tabId, session.id);
				this.shellLabels.set(tabId, normalizeShellLabel(session.shell));
				return session.id;
			})
			.catch((error) => {
				this.pendingSessionCreates.delete(tabId);
				throw error;
			});

		this.pendingSessionCreates.set(tabId, createPromise);
		return createPromise;
	}

	closeSession(tabId: string): void {
		this.closeRequestedWhilePending.add(tabId);
		const sessionId = this.tabToSession.get(tabId);
		this.pendingSessionCreates.delete(tabId);
		this.tabToSession.delete(tabId);
		this.shellLabels.delete(tabId);
		this.sessionSnapshots.delete(tabId);
		if (!sessionId) return;
		this.closeRequestedWhilePending.delete(tabId);
		void this.backend.close(sessionId);
	}

	hasSession(tabId: string): boolean {
		return this.tabToSession.has(tabId);
	}

	getSessionId(tabId: string): string | null {
		return this.tabToSession.get(tabId) ?? null;
	}

	getShellLabel(tabId: string): string | null {
		return this.shellLabels.get(tabId) ?? null;
	}

	setSnapshot(tabId: string, snapshot: string): void {
		if (!snapshot) {
			this.sessionSnapshots.delete(tabId);
			return;
		}
		this.sessionSnapshots.set(tabId, trimSnapshot(snapshot));
	}

	getSnapshot(tabId: string): string {
		return this.sessionSnapshots.get(tabId) ?? "";
	}

	clearSnapshot(tabId: string): void {
		this.sessionSnapshots.delete(tabId);
	}
}
