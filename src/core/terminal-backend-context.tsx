import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TerminalBackend } from "./terminal-backend";
import { electronTerminalBackend } from "../backends/electron-terminal-backend";
import { SessionManager } from "./session-manager";

const TerminalBackendContext = createContext<TerminalBackend>(electronTerminalBackend);
const SessionManagerContext = createContext<SessionManager>(new SessionManager(electronTerminalBackend));

interface TerminalBackendProviderProps {
	value: TerminalBackend;
	children: ReactNode;
}

export function TerminalBackendProvider({ value, children }: TerminalBackendProviderProps) {
	const sessionManager = useMemo(() => new SessionManager(value), [value]);

	return (
		<TerminalBackendContext.Provider value={value}>
			<SessionManagerContext.Provider value={sessionManager}>{children}</SessionManagerContext.Provider>
		</TerminalBackendContext.Provider>
	);
}

export function useTerminalBackend() {
	return useContext(TerminalBackendContext);
}

export function useSessionManager() {
	return useContext(SessionManagerContext);
}
