import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { WebLinksAddon } from "xterm-addon-web-links";
import { WebglAddon } from "xterm-addon-webgl";
import { Unicode11Addon } from "xterm-addon-unicode11";
import { useTerminalBackend } from "../core/terminal-backend-context";
import type { PaneStatus, PaneModel, TerminalTabModel } from "../core/models";
import type { MosaicTheme } from "../core/themes";
import { normalizeShellLabel } from "../core/terminal-utils";

interface TerminalTabSurfaceProps {
	tab: TerminalTabModel;
	accent: string;
	theme: MosaicTheme;
	cwd: string;
	isActive: boolean;
	onUpdateTabMeta: (patch: Partial<Pick<TerminalTabModel, "status" | "shellLabel" | "message">>) => void;
}

interface TerminalPaneProps {
	pane: PaneModel;
	accent: string;
	theme: MosaicTheme;
	cwd: string;
	focused: boolean;
	onFocus: () => void;
	onSplitVertical: () => void;
	onSplitHorizontal: () => void;
	onClose: () => void;
	onAddTab: () => void;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onUpdateTabMeta: (tabId: string, patch: Partial<Pick<TerminalTabModel, "status" | "shellLabel" | "message">>) => void;
}

function buildTerminalTheme(theme: MosaicTheme, accent: string) {
	return {
		background: "#00000000",
		foreground: theme.terminal.foreground,
		cursor: accent,
		cursorAccent: theme.terminal.cursorAccent,
		selectionBackground: theme.terminal.selectionBackground,
		black: theme.terminal.black,
		brightBlack: theme.terminal.brightBlack,
		red: theme.terminal.red,
		green: theme.terminal.green,
		yellow: theme.terminal.yellow,
		blue: theme.terminal.blue,
		magenta: theme.terminal.magenta,
		cyan: theme.terminal.cyan,
		white: theme.terminal.white,
		brightWhite: theme.terminal.brightWhite,
	};
}

function TerminalTabSurface({ tab, accent, theme, cwd, isActive, onUpdateTabMeta }: TerminalTabSurfaceProps) {
	const backend = useTerminalBackend();
	const terminalRef = useRef<HTMLDivElement | null>(null);
	const terminalInstanceRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const sessionRef = useRef<string | null>(null);
	const idleTimerRef = useRef<number | null>(null);
	const unsubscribeRef = useRef<(() => void) | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const updateTabMetaRef = useRef(onUpdateTabMeta);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");

	useEffect(() => {
		updateTabMetaRef.current = onUpdateTabMeta;
	}, [onUpdateTabMeta]);

	useEffect(() => {
		if (!isActive) return;
		if (!terminalRef.current) return;
		const unavailable = backend.createUnavailableSnapshot();
		if (!backend.isAvailable()) {
			updateTabMetaRef.current({
				status: unavailable.status,
				shellLabel: unavailable.shellLabel,
				message: unavailable.message,
			});
			return;
		}

		let terminal: Terminal;
		let fitAddon: FitAddon;

		try {
			terminal = new Terminal({
				fontFamily: '"IBM Plex Mono", "JetBrains Mono", monospace',
				fontSize: 12,
				lineHeight: 1.18,
				cursorBlink: true,
				allowTransparency: true,
				theme: buildTerminalTheme(theme, accent),
			});

			fitAddon = new FitAddon();
			const searchAddon = new SearchAddon();
			const webLinksAddon = new WebLinksAddon((_event, uri) => {
				window.open(uri, "_blank");
			});
			const unicode11Addon = new Unicode11Addon();

			terminal.loadAddon(fitAddon);
			terminal.loadAddon(searchAddon);
			terminal.loadAddon(webLinksAddon);
			terminal.loadAddon(unicode11Addon);
			terminal.unicode.activeVersion = "11";

			terminal.open(terminalRef.current);

			try {
				const webglAddon = new WebglAddon();
				webglAddon.onContextLoss(() => webglAddon.dispose());
				terminal.loadAddon(webglAddon);
			} catch {
				// WebGL unavailable — canvas renderer is fine
			}

			searchAddonRef.current = searchAddon;
			fitAddon.fit();
		} catch (error) {
			updateTabMetaRef.current({
				status: "unavailable",
				shellLabel: "error",
				message: error instanceof Error ? error.message : "Terminal failed to initialize.",
			});
			return;
		}

		terminalInstanceRef.current = terminal;
		fitAddonRef.current = fitAddon;

		let disposed = false;

		const markBusy = () => {
			updateTabMetaRef.current({ status: "busy" });
			if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
			idleTimerRef.current = window.setTimeout(() => updateTabMetaRef.current({ status: "idle" }), 900);
		};

		backend
			.createSession({ cwd })
			.then((session) => {
				if (disposed) return;

				sessionRef.current = session.id;
				updateTabMetaRef.current({
					shellLabel: normalizeShellLabel(session.shell),
					status: "idle",
					message: "Connected",
				});

				const resizeTerminal = () => {
					if (!fitAddonRef.current || !sessionRef.current) return;
					fitAddonRef.current.fit();
					void backend.resize(sessionRef.current, terminal.cols, terminal.rows);
				};

				resizeTerminal();

				unsubscribeRef.current = backend.subscribe(session.id, {
					onData: (data) => {
						terminal.write(data);
						markBusy();
					},
					onExit: () => {
						updateTabMetaRef.current({ status: "exited", message: "Process exited" });
						terminal.writeln("\r\n[process exited]");
					},
					onStatusChange: (nextStatus, nextMessage) => {
						updateTabMetaRef.current({ status: nextStatus, message: nextMessage });
					},
				});

				terminal.onData((data) => {
					if (!sessionRef.current) return;
					markBusy();
					void backend.write(sessionRef.current, data);
				});

				resizeObserverRef.current = new ResizeObserver(resizeTerminal);
				if (terminalRef.current) resizeObserverRef.current.observe(terminalRef.current);
			})
			.catch((error: unknown) => {
				updateTabMetaRef.current({
					status: "unavailable",
					shellLabel: "error",
					message: error instanceof Error ? error.message : "Failed to start terminal session.",
				});
			});

		return () => {
			disposed = true;
			if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
			resizeObserverRef.current?.disconnect();
			unsubscribeRef.current?.();
			if (sessionRef.current) void backend.close(sessionRef.current);
			terminalInstanceRef.current = null;
			terminal.dispose();
		};
	}, [backend, cwd, isActive, tab.id]);

	useEffect(() => {
		if (!isActive || !terminalInstanceRef.current) return;
		terminalInstanceRef.current.options.theme = buildTerminalTheme(theme, accent);
	}, [accent, isActive, theme]);

	useEffect(() => {
		if (!isActive || !fitAddonRef.current) return;
		window.requestAnimationFrame(() => fitAddonRef.current?.fit());
	}, [isActive]);

	useEffect(() => {
		if (!isActive || typeof window.mosaic?.onContextMenuAction !== "function") return;

		return window.mosaic.onContextMenuAction((data) => {
			const terminal = terminalInstanceRef.current;
			if (!terminal) return;
			if (data.sessionId !== null && data.sessionId !== sessionRef.current) return;

			switch (data.action) {
				case "copy":
					if (terminal.hasSelection()) {
						void navigator.clipboard.writeText(terminal.getSelection());
					}
					break;
				case "paste":
					void navigator.clipboard.readText().then((text) => {
						if (text && sessionRef.current) {
							void backend.write(sessionRef.current, text);
						}
					});
					break;
				case "selectAll":
					terminal.selectAll();
					break;
				case "clear":
					terminal.clear();
					break;
				case "find":
					setSearchOpen(true);
					break;
			}
		});
	}, [backend, isActive]);

	const handleContextMenu = useCallback(() => {
		if (typeof window.mosaic?.showTerminalContextMenu === "function") {
			window.mosaic.showTerminalContextMenu(sessionRef.current);
		}
	}, []);

	const openSearch = useCallback(() => {
		setSearchOpen(true);
	}, []);

	const closeSearch = useCallback(() => {
		setSearchOpen(false);
		setSearchQuery("");
		searchAddonRef.current?.clearDecorations();
		terminalInstanceRef.current?.focus();
	}, []);

	const handleSearchChange = useCallback((value: string) => {
		setSearchQuery(value);
		if (value) {
			searchAddonRef.current?.findNext(value, { decorations: { matchOverviewRuler: "#888", activeMatchColorOverviewRuler: "#fff", matchBackground: "#555", activeMatchBackground: "#e8a634" } });
		} else {
			searchAddonRef.current?.clearDecorations();
		}
	}, []);

	const handleSearchNext = useCallback(() => {
		if (searchQuery) searchAddonRef.current?.findNext(searchQuery);
	}, [searchQuery]);

	const handleSearchPrev = useCallback(() => {
		if (searchQuery) searchAddonRef.current?.findPrevious(searchQuery);
	}, [searchQuery]);

	useEffect(() => {
		if (!isActive) return;
		const handleKeydown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "f") {
				event.preventDefault();
				openSearch();
			}
			if (event.key === "Escape" && searchOpen) {
				closeSearch();
			}
		};
		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	}, [isActive, searchOpen, openSearch, closeSearch]);

	useEffect(() => {
		if (searchOpen && searchInputRef.current) {
			searchInputRef.current.focus();
		}
	}, [searchOpen]);

	return (
		<div className={`pane-tab-surface ${isActive ? "active" : ""}`}>
			{searchOpen ? (
				<div className="terminal-search-bar">
					<input
						ref={searchInputRef}
						type="text"
						className="terminal-search-input"
						value={searchQuery}
						onChange={(event) => handleSearchChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								if (event.shiftKey) handleSearchPrev();
								else handleSearchNext();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								closeSearch();
							}
						}}
						placeholder="Find…"
						spellCheck={false}
					/>
					<button type="button" className="terminal-search-nav" onClick={handleSearchPrev} aria-label="Previous match">▲</button>
					<button type="button" className="terminal-search-nav" onClick={handleSearchNext} aria-label="Next match">▼</button>
					<button type="button" className="terminal-search-close" onClick={closeSearch} aria-label="Close search">×</button>
				</div>
			) : null}
			<div className="terminal-well scanline-well" onContextMenu={handleContextMenu}>
				<div ref={terminalRef} className="terminal-mount" />
			</div>

			{tab.status === "unavailable" ? <div className="pane-footer-note">{tab.message ?? "terminal bridge unavailable"}</div> : null}
		</div>
	);
}

export function TerminalPane({
	pane,
	accent,
	theme,
	cwd,
	focused,
	onFocus,
	onSplitVertical,
	onSplitHorizontal,
	onClose,
	onAddTab,
	onSelectTab,
	onCloseTab,
	onUpdateTabMeta,
}: TerminalPaneProps) {
	const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];

	return (
		<section
			className={`terminal-pane ${focused ? "focused" : ""}`}
			style={{ ["--workspace-accent" as string]: accent, ["--glow-color" as string]: accent }}
			onMouseDown={onFocus}
		>
			<div className="terminal-pane-accent" />

			<div className="pane-header pane-header-tabs">
				<div className="pane-tab-strip">
					{pane.tabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							className={`pane-tab-button ${tab.id === activeTab.id ? "active" : ""}`}
							onClick={() => onSelectTab(tab.id)}
							title={tab.title}
						>
							<span className={`status-dot pane-tab-status status-${tab.status}`} />
							<span className="pane-tab-title">{tab.title}</span>
							{pane.tabs.length > 1 ? (
								<span
									className="pane-tab-close"
									role="button"
									tabIndex={0}
									onClick={(event) => {
										event.stopPropagation();
										onCloseTab(tab.id);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											event.stopPropagation();
											onCloseTab(tab.id);
										}
									}}
								>
									x
								</span>
							) : null}
						</button>
					))}
					<button type="button" className="pane-tab-add" onClick={onAddTab} aria-label="Open a new tab">
						+
					</button>
				</div>

				<div className="pane-actions">
					<button type="button" className="pane-action-button" onClick={onSplitVertical} aria-label={`Split ${activeTab.title} vertically`}>
						|
					</button>
					<button type="button" className="pane-action-button" onClick={onSplitHorizontal} aria-label={`Split ${activeTab.title} horizontally`}>
						-
					</button>
					<button type="button" className="pane-close-button" onClick={onClose} aria-label={`Close ${activeTab.title}`}>
						x
					</button>
				</div>
			</div>

			<div className="pane-body">
				<TerminalTabSurface
					key={activeTab.id}
					tab={activeTab}
					accent={accent}
					theme={theme}
					cwd={cwd}
					isActive
					onUpdateTabMeta={(patch) => onUpdateTabMeta(activeTab.id, patch)}
				/>
			</div>
		</section>
	);
}
