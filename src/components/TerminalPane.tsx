import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { SerializeAddon } from "xterm-addon-serialize";
import { WebLinksAddon } from "xterm-addon-web-links";
import { useSessionManager, useTerminalBackend } from "../core/terminal-backend-context";
import type { PaneModel, TerminalTabModel } from "../core/models";
import type { MosaicTheme } from "../core/themes";

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
	zoomed: boolean;
	onFocus: () => void;
	onSplitVertical: () => void;
	onSplitHorizontal: () => void;
	onClose: () => void;
	onAddTab: () => void;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onMoveTab: (sourcePaneId: string, tabId: string, targetPaneId: string) => void;
	onToggleZoom: () => void;
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

const PANE_TAB_DND_TYPE = "application/x-mosaic-pane-tab";

function parseDraggedTab(event: Pick<DragEvent, "dataTransfer">) {
	const payload = event.dataTransfer?.getData(PANE_TAB_DND_TYPE);
	if (!payload) return null;
	try {
		const parsed = JSON.parse(payload) as { sourcePaneId?: string; tabId?: string };
		if (!parsed.sourcePaneId || !parsed.tabId) return null;
		return { sourcePaneId: parsed.sourcePaneId, tabId: parsed.tabId };
	} catch {
		return null;
	}
}

function TerminalTabSurface({ tab, accent, theme, cwd, isActive, onUpdateTabMeta }: TerminalTabSurfaceProps) {
	const backend = useTerminalBackend();
	const sessionManager = useSessionManager();
	const terminalRef = useRef<HTMLDivElement | null>(null);
	const terminalInstanceRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const serializeAddonRef = useRef<SerializeAddon | null>(null);
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
		let serializeAddon: SerializeAddon;
		let inputDisposable: { dispose: () => void } | null = null;
		let snapshotIntervalId: number | null = null;

		try {
			terminal = new Terminal({
				fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
				fontSize: 12,
				lineHeight: 1.18,
				cursorBlink: true,
				allowTransparency: true,
				allowProposedApi: true,
				theme: buildTerminalTheme(theme, accent),
			});

			fitAddon = new FitAddon();
			const searchAddon = new SearchAddon();
			const webLinksAddon = new WebLinksAddon((_event, uri) => {
				window.open(uri, "_blank");
			});
			serializeAddon = new SerializeAddon();

			terminal.loadAddon(fitAddon);
			terminal.loadAddon(searchAddon);
			terminal.loadAddon(webLinksAddon);
			terminal.loadAddon(serializeAddon);

			terminal.open(terminalRef.current);
			const snapshot = sessionManager.getSnapshot(tab.id);
			if (snapshot) terminal.write(snapshot);

			searchAddonRef.current = searchAddon;
			serializeAddonRef.current = serializeAddon;
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

		sessionManager
			.ensureSession(tab.id, cwd)
			.then((sessionId) => {
				if (disposed) return;

				sessionRef.current = sessionId;
				updateTabMetaRef.current({
					shellLabel: sessionManager.getShellLabel(tab.id) ?? tab.shellLabel ?? "shell",
					status: "idle",
					message: "Connected",
				});

				const resizeTerminal = () => {
					if (!fitAddonRef.current || !sessionRef.current) return;
					fitAddonRef.current.fit();
					void backend.resize(sessionRef.current, terminal.cols, terminal.rows);
				};

				resizeTerminal();

				unsubscribeRef.current = backend.subscribe(sessionId, {
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

				inputDisposable = terminal.onData((data) => {
					if (!sessionRef.current) return;
					markBusy();
					void backend.write(sessionRef.current, data);
				});

				resizeObserverRef.current = new ResizeObserver(resizeTerminal);
				if (terminalRef.current) resizeObserverRef.current.observe(terminalRef.current);

				snapshotIntervalId = window.setInterval(() => {
					if (!serializeAddonRef.current) return;
					sessionManager.setSnapshot(tab.id, serializeAddonRef.current.serialize());
				}, 1200);
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
			if (snapshotIntervalId) window.clearInterval(snapshotIntervalId);
			resizeObserverRef.current?.disconnect();
			resizeObserverRef.current = null;
			unsubscribeRef.current?.();
			unsubscribeRef.current = null;
			inputDisposable?.dispose();
			if (serializeAddonRef.current) {
				sessionManager.setSnapshot(tab.id, serializeAddonRef.current.serialize());
			}
			terminalInstanceRef.current = null;
			sessionRef.current = null;
			terminal.dispose();
		};
	}, [backend, tab.id]);

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
	zoomed,
	onFocus,
	onSplitVertical,
	onSplitHorizontal,
	onClose,
	onAddTab,
	onSelectTab,
	onCloseTab,
	onMoveTab,
	onToggleZoom,
	onUpdateTabMeta,
}: TerminalPaneProps) {
	const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
	const [tabDropActive, setTabDropActive] = useState(false);
	const [draggingTabId, setDraggingTabId] = useState<string | null>(null);

	const handleTabStripDragOver = useCallback(
		(event: ReactDragEvent<HTMLDivElement>) => {
			const payload = parseDraggedTab(event);
			if (!payload || payload.sourcePaneId === pane.id) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			setTabDropActive(true);
		},
		[pane.id],
	);

	const handleTabStripDrop = useCallback(
		(event: ReactDragEvent<HTMLDivElement>) => {
			setTabDropActive(false);
			const payload = parseDraggedTab(event);
			if (!payload || payload.sourcePaneId === pane.id) return;
			event.preventDefault();
			onMoveTab(payload.sourcePaneId, payload.tabId, pane.id);
		},
		[onMoveTab, pane.id],
	);

	return (
		<section
			className={`terminal-pane ${focused ? "focused" : ""} ${zoomed ? "zoomed" : ""}`}
			style={{ ["--workspace-accent" as string]: accent, ["--glow-color" as string]: accent }}
			onMouseDown={onFocus}
		>
			<div className="terminal-pane-accent" />

			<div
				className="pane-header pane-header-tabs"
				onDoubleClick={(event) => {
					const target = event.target as HTMLElement;
					if (target.closest("button") || target.closest('[role="button"]')) return;
					onToggleZoom();
				}}
			>
				<div
					className={`pane-tab-strip ${tabDropActive ? "tab-drop-target" : ""}`}
					onDragOver={handleTabStripDragOver}
					onDrop={handleTabStripDrop}
					onDragLeave={(event) => {
						const nextTarget = event.relatedTarget as Node | null;
						if (nextTarget && event.currentTarget.contains(nextTarget)) return;
						setTabDropActive(false);
					}}
				>
					{pane.tabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							draggable
							className={`pane-tab-button ${tab.id === activeTab.id ? "active" : ""} ${draggingTabId === tab.id ? "tab-dragging" : ""}`}
							onDragStart={(event) => {
								setDraggingTabId(tab.id);
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData(PANE_TAB_DND_TYPE, JSON.stringify({ sourcePaneId: pane.id, tabId: tab.id }));
								event.dataTransfer.setData("text/plain", tab.id);
							}}
							onDragEnd={() => {
								setDraggingTabId(null);
								setTabDropActive(false);
							}}
							onClick={() => onSelectTab(tab.id)}
							title={tab.title}
							aria-grabbed={draggingTabId === tab.id}
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
									×
								</span>
							) : null}
						</button>
					))}
					<button type="button" className="pane-tab-add" onClick={onAddTab} aria-label="Open a new tab">
						+
					</button>
				</div>

				<div className="pane-actions">
					{zoomed ? <span className="pane-zoom-pill">Focus mode</span> : null}
					<div className="pane-action-slot" data-tooltip={zoomed ? "Exit focus mode" : "Focus this pane"}>
						<button
							type="button"
							className={`pane-action-button zoom-toggle ${zoomed ? "active" : ""}`}
							onClick={onToggleZoom}
							aria-label={zoomed ? "Exit focus mode" : "Focus this pane"}
						/>
					</div>
					<div className="pane-action-slot" data-tooltip="Split vertically">
						<button type="button" className="pane-action-button split-v" onClick={onSplitVertical} aria-label={`Split ${activeTab.title} vertically`} />
					</div>
					<div className="pane-action-slot" data-tooltip="Split horizontally">
						<button type="button" className="pane-action-button split-h" onClick={onSplitHorizontal} aria-label={`Split ${activeTab.title} horizontally`} />
					</div>
					<div className="pane-action-slot" data-tooltip="Close pane">
						<button type="button" className="pane-close-button" onClick={onClose} aria-label={`Close ${activeTab.title}`}>
							×
						</button>
					</div>
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
