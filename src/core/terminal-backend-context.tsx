import { createContext, useContext } from "react";
import type { TerminalBackend } from "./terminal-backend";
import { electronTerminalBackend } from "../backends/electron-terminal-backend";

const TerminalBackendContext = createContext<TerminalBackend>(electronTerminalBackend);

export const TerminalBackendProvider = TerminalBackendContext.Provider;

export function useTerminalBackend() {
	return useContext(TerminalBackendContext);
}
