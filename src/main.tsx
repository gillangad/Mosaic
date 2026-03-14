import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { TerminalBackendProvider } from "./core/terminal-backend-context";
import { electronTerminalBackend } from "./backends/electron-terminal-backend";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./styles.css";
import "xterm/css/xterm.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<TerminalBackendProvider value={electronTerminalBackend}>
			<ErrorBoundary>
				<App />
			</ErrorBoundary>
		</TerminalBackendProvider>
	</React.StrictMode>,
);
