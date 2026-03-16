import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent as ReactDragEvent,
	type MouseEvent as ReactMouseEvent,
} from "react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { SerializeAddon } from "xterm-addon-serialize";
import { WebLinksAddon } from "xterm-addon-web-links";

import { useSessionManager, useTerminalBackend } from "../core/terminal-backend-context";
import type { BrowserTabModel, EditorTabModel, FileTreeTabModel, ImageTabModel, PaneModel, PaneTabModel, PdfTabModel, TerminalTabModel } from "../core/models";
import { BrowserPane } from "./BrowserPane";
import type { PaneDropPosition } from "../core/layout";
import { getTabStatus } from "../core/pane-tabs";
import type { MosaicTheme } from "../core/themes";

interface TerminalTabSurfaceProps {
	tab: TerminalTabModel;
	accent: string;
	theme: MosaicTheme;
	cwd: string;
	isActive: boolean;
	onUpdateTabMeta: (patch: Partial<Pick<TerminalTabModel, "status" | "shellLabel" | "message" | "title">>) => void;
}

interface TerminalPaneProps {
	pane: PaneModel;
	accent: string;
	theme: MosaicTheme;
	cwd: string;
	focused: boolean;
	zoomed: boolean;
	onFocus: () => void;
	onMoveToNewColumn: () => void;
	canMoveToNewColumn: boolean;
	onSplitVertical: () => void;
	onSplitHorizontal: () => void;
	onClose: () => void;
	onAddTab: () => void;
	onAddBrowserTab: () => void;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onMoveTab: (sourcePaneId: string, tabId: string, targetPaneId: string) => void;
	onDropTabToPane: (sourcePaneId: string, tabId: string, position: PaneDropPosition) => void;
	onToggleZoom: () => void;
	onBeginShiftDrag: (clientX: number, clientY: number) => void;
	onUpdateTabMeta: (tabId: string, patch: Partial<Pick<TerminalTabModel, "status" | "shellLabel" | "message" | "title">>) => void;
	onOpenFile: (filePath: string) => void;
	onUpdateTab: (tabId: string, updater: (tab: PaneTabModel) => PaneTabModel) => void;
}

interface FileTreeEntry {
	name: string;
	path: string;
	relativePath: string;
	isDirectory: boolean;
	extension: string;
}

function buildTerminalTheme(theme: MosaicTheme, accent: string) {
	return {
		background: theme.bgWell,
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
const PDF_WORKER_SRC = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
const MonacoEditor = lazy(() => import("@monaco-editor/react"));

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

function resolvePaneDropPosition(rect: DOMRect, clientX: number, clientY: number): PaneDropPosition {
	const relativeX = (clientX - rect.left) / Math.max(rect.width, 1);
	const relativeY = (clientY - rect.top) / Math.max(rect.height, 1);

	if (relativeX > 0.28 && relativeX < 0.72 && relativeY > 0.28 && relativeY < 0.72) {
		return "center";
	}

	const distances = [
		{ position: "left" as const, value: relativeX },
		{ position: "right" as const, value: 1 - relativeX },
		{ position: "top" as const, value: relativeY },
		{ position: "bottom" as const, value: 1 - relativeY },
	].sort((a, b) => a.value - b.value);

	return distances[0].position;
}

function FileTypeIcon({ entry }: { entry: FileTreeEntry }) {
	if (entry.isDirectory) {
		return (
			<svg className="file-tree-icon-svg folder" viewBox="0 0 16 16" fill="none">
				<path d="M1.5 2.5h4.25l1.5 1.5h7.25v9.5h-13z" fill="currentColor" opacity="0.85" />
			</svg>
		);
	}
	const ext = entry.extension.toLowerCase();
	let colorClass = "default";
	if (["ts", "tsx"].includes(ext)) colorClass = "typescript";
	else if (["js", "jsx", "mjs", "cjs"].includes(ext)) colorClass = "javascript";
	else if (["json", "yaml", "yml", "toml", "ini"].includes(ext)) colorClass = "config";
	else if (["md", "markdown"].includes(ext)) colorClass = "markdown";
	else if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) colorClass = "image";
	else if (["css", "scss", "less"].includes(ext)) colorClass = "style";
	else if (["sh", "bash", "zsh", "ps1"].includes(ext)) colorClass = "shell";
	else if (["html", "htm"].includes(ext)) colorClass = "html";
	else if (["py"].includes(ext)) colorClass = "python";
	else if (["rs"].includes(ext)) colorClass = "rust";
	else if (["go"].includes(ext)) colorClass = "go";
	return (
		<svg className={`file-tree-icon-svg file-icon-${colorClass}`} viewBox="0 0 16 16" fill="none">
			<path d="M3 1.5h6.5l3 3V14.5H3z" stroke="currentColor" strokeWidth="1" fill="none" />
			<path d="M9.5 1.5v3h3" stroke="currentColor" strokeWidth="1" fill="none" />
		</svg>
	);
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
	return (
		<svg className={`file-tree-chevron ${expanded ? "expanded" : ""}`} viewBox="0 0 16 16" fill="none">
			<path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
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
	const unsubscribeRef = useRef<(() => void) | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const resizeFrameRef = useRef<number | null>(null);
	const lastResizeRef = useRef({ cols: 0, rows: 0 });
	const updateTabMetaRef = useRef(onUpdateTabMeta);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const searchDebounceTimerRef = useRef<number | null>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchMatchState, setSearchMatchState] = useState({ current: 0, total: 0 });

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
		let titleDisposable: { dispose: () => void } | null = null;
		let snapshotIntervalId: number | null = null;

		try {
			terminal = new Terminal({
				fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
				fontSize: 12,
				lineHeight: 1.18,
				cursorBlink: true,
				allowTransparency: false,
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
					if (resizeFrameRef.current !== null) return;
					resizeFrameRef.current = window.requestAnimationFrame(() => {
						resizeFrameRef.current = null;
						if (!fitAddonRef.current || !sessionRef.current) return;
						fitAddonRef.current.fit();
						const nextCols = terminal.cols;
						const nextRows = terminal.rows;
						if (nextCols <= 0 || nextRows <= 0) return;
						if (nextCols === lastResizeRef.current.cols && nextRows === lastResizeRef.current.rows) return;
						lastResizeRef.current = { cols: nextCols, rows: nextRows };
						void backend.resize(sessionRef.current, nextCols, nextRows);
					});
				};

				resizeTerminal();

				unsubscribeRef.current = backend.subscribe(sessionId, {
					onData: (data) => {
						terminal.write(data);
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
					void backend.write(sessionRef.current, data);
				});

				titleDisposable = terminal.onTitleChange((nextTitle) => {
					if (nextTitle) updateTabMetaRef.current({ title: nextTitle });
				});

				resizeObserverRef.current = new ResizeObserver(resizeTerminal);
				if (terminalRef.current) resizeObserverRef.current.observe(terminalRef.current);

				snapshotIntervalId = window.setInterval(() => {
					if (!serializeAddonRef.current) return;
					sessionManager.setSnapshot(tab.id, serializeAddonRef.current.serialize());
				}, 15000);
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
			if (searchDebounceTimerRef.current) {
				window.clearTimeout(searchDebounceTimerRef.current);
				searchDebounceTimerRef.current = null;
			}
			if (snapshotIntervalId) window.clearInterval(snapshotIntervalId);
			if (resizeFrameRef.current !== null) {
				window.cancelAnimationFrame(resizeFrameRef.current);
				resizeFrameRef.current = null;
			}
			resizeObserverRef.current?.disconnect();
			resizeObserverRef.current = null;
			unsubscribeRef.current?.();
			unsubscribeRef.current = null;
			inputDisposable?.dispose();
			titleDisposable?.dispose();
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

	const countTerminalMatches = useCallback((query: string) => {
		const terminal = terminalInstanceRef.current;
		if (!terminal || !query) return 0;

		const loweredQuery = query.toLowerCase();
		const { active } = terminal.buffer;
		const maxLine = active.baseY + active.length;
		let total = 0;

		for (let lineIndex = 0; lineIndex < maxLine; lineIndex += 1) {
			const line = active.getLine(lineIndex);
			if (!line) continue;
			const text = line.translateToString(true).toLowerCase();
			if (!text) continue;
			let searchIndex = text.indexOf(loweredQuery);
			while (searchIndex !== -1) {
				total += 1;
				searchIndex = text.indexOf(loweredQuery, searchIndex + Math.max(loweredQuery.length, 1));
			}
		}

		return total;
	}, []);

	const runSearch = useCallback((query: string) => {
		if (!query) {
			searchAddonRef.current?.clearDecorations();
			setSearchMatchState({ current: 0, total: 0 });
			return;
		}

		const total = countTerminalMatches(query);
		const found = searchAddonRef.current?.findNext(query, {
			decorations: {
				matchOverviewRuler: "#888",
				activeMatchColorOverviewRuler: "#fff",
				matchBackground: "#555",
				activeMatchBackground: "#e8a634",
			},
		}) ?? false;
		setSearchMatchState({ current: found && total > 0 ? 1 : 0, total });
	}, [countTerminalMatches]);

	const openSearch = useCallback(() => {
		setSearchOpen(true);
	}, []);

	const closeSearch = useCallback(() => {
		if (searchDebounceTimerRef.current) {
			window.clearTimeout(searchDebounceTimerRef.current);
			searchDebounceTimerRef.current = null;
		}
		setSearchOpen(false);
		setSearchQuery("");
		setSearchMatchState({ current: 0, total: 0 });
		searchAddonRef.current?.clearDecorations();
		terminalInstanceRef.current?.focus();
	}, []);

	const handleSearchChange = useCallback((value: string) => {
		setSearchQuery(value);
		if (searchDebounceTimerRef.current) window.clearTimeout(searchDebounceTimerRef.current);
		searchDebounceTimerRef.current = window.setTimeout(() => {
			searchDebounceTimerRef.current = null;
			runSearch(value);
		}, 120);
	}, [runSearch]);

	const handleSearchNext = useCallback(() => {
		if (!searchQuery) return;
		const found = searchAddonRef.current?.findNext(searchQuery) ?? false;
		if (!found || searchMatchState.total === 0) return;
		setSearchMatchState((current) => ({
			...current,
			current: current.current >= current.total ? 1 : current.current + 1,
		}));
	}, [searchMatchState.total, searchQuery]);

	const handleSearchPrev = useCallback(() => {
		if (!searchQuery) return;
		const found = searchAddonRef.current?.findPrevious(searchQuery) ?? false;
		if (!found || searchMatchState.total === 0) return;
		setSearchMatchState((current) => ({
			...current,
			current: current.current <= 1 ? current.total : current.current - 1,
		}));
	}, [searchMatchState.total, searchQuery]);

	useEffect(() => {
		if (searchOpen && searchInputRef.current) {
			searchInputRef.current.focus();
			searchInputRef.current.select();
		}
	}, [searchOpen]);

	return (
		<div
			className={`pane-tab-surface ${isActive ? "active" : "inactive"}`}
			onKeyDownCapture={(event) => {
				if (!isActive) return;
				if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
					event.preventDefault();
					event.stopPropagation();
					openSearch();
					return;
				}
				if (event.key === "Escape" && searchOpen) {
					event.preventDefault();
					event.stopPropagation();
					closeSearch();
				}
			}}
		>
			<div className="terminal-well scanline-well" onContextMenu={handleContextMenu}>
				{searchOpen ? (
					<div className="terminal-search-overlay" role="search">
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
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									closeSearch();
								}
							}}
							placeholder="Find"
							spellCheck={false}
						/>
						<span className="terminal-search-count" aria-live="polite">
							{searchMatchState.total === 0 ? "0 of 0" : `${Math.max(searchMatchState.current, 1)} of ${searchMatchState.total}`}
						</span>
						<button type="button" className="terminal-search-nav" onClick={handleSearchPrev} aria-label="Previous match">↑</button>
						<button type="button" className="terminal-search-nav" onClick={handleSearchNext} aria-label="Next match">↓</button>
						<button type="button" className="terminal-search-close" onClick={closeSearch} aria-label="Close search">×</button>
					</div>
				) : null}
				<div ref={terminalRef} className="terminal-mount" />
			</div>

			{tab.status === "unavailable" ? <div className="pane-footer-note">{tab.message ?? "terminal bridge unavailable"}</div> : null}
		</div>
	);
}

function FileTreeTabSurface({ tab, onOpenFile, isActive }: { tab: FileTreeTabModel; onOpenFile: (filePath: string) => void; isActive: boolean }) {
	const [entriesByPath, setEntriesByPath] = useState<Record<string, FileTreeEntry[]>>({});
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([tab.rootPath]));
	const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filterQuery, setFilterQuery] = useState("");
	const filterInputRef = useRef<HTMLInputElement | null>(null);

	const loadDirectory = useCallback(
		async (directoryPath: string) => {
			if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
			setLoadingPaths((current) => {
				const next = new Set(current);
				next.add(directoryPath);
				return next;
			});
			setError(null);
			try {
				const entries = await window.mosaic.readDirectory(tab.rootPath, directoryPath);
				setEntriesByPath((current) => ({ ...current, [directoryPath]: entries }));
			} catch (loadError) {
				setError(loadError instanceof Error ? loadError.message : "Unable to read directory.");
			} finally {
				setLoadingPaths((current) => {
					const next = new Set(current);
					next.delete(directoryPath);
					return next;
				});
			}
		},
		[tab.rootPath],
	);

	useEffect(() => {
		void loadDirectory(tab.rootPath);
	}, [loadDirectory, tab.rootPath]);

	useEffect(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "f") {
				event.preventDefault();
				filterInputRef.current?.focus();
			}
			if (event.key === "Escape" && filterQuery) {
				setFilterQuery("");
			}
		};
		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	}, [filterQuery]);

	const toggleDirectory = useCallback(
		(entry: FileTreeEntry) => {
			if (!entry.isDirectory) return;
			setExpandedPaths((current) => {
				const next = new Set(current);
				if (next.has(entry.path)) {
					next.delete(entry.path);
					return next;
				}
				next.add(entry.path);
				return next;
			});
			if (!entriesByPath[entry.path]) {
				void loadDirectory(entry.path);
			}
		},
		[entriesByPath, loadDirectory],
	);

	const filterLower = filterQuery.toLowerCase();

	const matchesFilter = useCallback(
		(parentPath: string): boolean => {
			if (!filterLower) return true;
			const entries = entriesByPath[parentPath] ?? [];
			return entries.some((entry) => {
				if (entry.name.toLowerCase().includes(filterLower)) return true;
				if (entry.isDirectory && entriesByPath[entry.path]) return matchesFilter(entry.path);
				return false;
			});
		},
		[entriesByPath, filterLower],
	);

	const renderEntries = useCallback(
		(parentPath: string, depth: number) => {
			let entries = entriesByPath[parentPath] ?? [];
			if (filterLower) {
				entries = entries.filter((entry) => {
					if (entry.name.toLowerCase().includes(filterLower)) return true;
					if (entry.isDirectory && entriesByPath[entry.path]) return matchesFilter(entry.path);
					return false;
				});
			}
			if (entries.length === 0) return null;
			return (
				<ul className="file-tree-list" role={depth === 0 ? "tree" : "group"}>
					{entries.map((entry) => {
						const isExpanded = expandedPaths.has(entry.path) || (!!filterLower && entry.isDirectory);
						const isLoading = loadingPaths.has(entry.path);
						const childCount = entriesByPath[entry.path]?.length;
						return (
							<li key={entry.path} className="file-tree-item" style={{ ["--tree-depth" as string]: String(depth) }}>
								<button
									type="button"
									className={`file-tree-row ${entry.isDirectory ? "directory" : "file"} ${selectedPath === entry.path ? "selected" : ""}`}
									onClick={() => {
										if (entry.isDirectory) {
											toggleDirectory(entry);
											return;
										}
										setSelectedPath(entry.path);
										onOpenFile(entry.path);
									}}
									role="treeitem"
									aria-expanded={entry.isDirectory ? isExpanded : undefined}
								>
									{Array.from({ length: depth }, (_, i) => (
										<span key={i} className="file-tree-guide-line" style={{ ["--guide-index" as string]: String(i) }} aria-hidden="true" />
									))}
									<span className="file-tree-caret" aria-hidden="true">
										{entry.isDirectory ? <ChevronIcon expanded={isExpanded} /> : null}
									</span>
									<span className="file-tree-icon" aria-hidden="true">
										<FileTypeIcon entry={entry} />
									</span>
									<span className="file-tree-name" title={entry.path}>{entry.name}</span>
									{entry.isDirectory && childCount !== undefined ? <span className="file-tree-count">{childCount}</span> : null}
								</button>
								{entry.isDirectory && isExpanded ? (
									<div className="file-tree-children">
										{isLoading ? <div className="file-tree-loading">Loading…</div> : null}
										{renderEntries(entry.path, depth + 1)}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			);
		},
		[entriesByPath, expandedPaths, filterLower, loadingPaths, matchesFilter, onOpenFile, selectedPath, toggleDirectory],
	);

	return (
		<div className={`pane-tab-surface ${isActive ? "active" : "inactive"}`}>
			<div className="file-tree-surface">
				<div className="file-tree-toolbar">
					<div className="file-tree-search">
						<svg className="file-tree-search-icon" viewBox="0 0 16 16" fill="none">
							<circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
							<path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
						</svg>
						<input
							ref={filterInputRef}
							type="text"
							className="file-tree-search-input"
							value={filterQuery}
							onChange={(event) => setFilterQuery(event.target.value)}
							placeholder="Filter files…"
							spellCheck={false}
						/>
						{filterQuery ? (
							<button type="button" className="file-tree-search-clear" onClick={() => setFilterQuery("")} aria-label="Clear filter">
								×
							</button>
						) : null}
					</div>
					<button
						type="button"
						className="file-tree-refresh"
						onClick={() => {
							void loadDirectory(tab.rootPath);
						}}
						aria-label="Refresh file tree"
					>
						<svg viewBox="0 0 16 16" fill="none" className="file-tree-refresh-icon">
							<path d="M13.5 8a5.5 5.5 0 1 1-1.5-3.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
							<path d="M13.5 2.5v2.5H11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
				</div>
				{error ? <div className="file-tree-error">{error}</div> : null}
				<div className="file-tree-scroll">{renderEntries(tab.rootPath, 0)}</div>
			</div>
		</div>
	);
}

function EditorTabSurface({
	tab,
	theme,
	onUpdateTab,
	isActive,
}: {
	tab: EditorTabModel;
	theme: MosaicTheme;
	onUpdateTab: (tabId: string, updater: (tab: PaneTabModel) => PaneTabModel) => void;
	isActive: boolean;
}) {
	const contentRef = useRef(tab.content);
	const savedContentRef = useRef(tab.savedContent);
	const dirtyRef = useRef(tab.dirty);
	const persistTimerRef = useRef<number | null>(null);
	const [draftContent, setDraftContent] = useState(tab.content);
	const [isDirty, setIsDirty] = useState(tab.dirty);
	const [saveMessage, setSaveMessage] = useState("");
	const saveMessageTimerRef = useRef<number | null>(null);

	const persistDraft = useCallback(
		(nextContent: string) => {
			onUpdateTab(tab.id, (current) => {
				if (current.kind !== "editor") return current;
				const nextDirty = nextContent !== current.savedContent;
				if (current.content === nextContent && current.dirty === nextDirty) return current;
				return {
					...current,
					content: nextContent,
					dirty: nextDirty,
				};
			});
		},
		[onUpdateTab, tab.id],
	);

	const flushDraft = useCallback(() => {
		if (persistTimerRef.current) {
			window.clearTimeout(persistTimerRef.current);
			persistTimerRef.current = null;
		}
		persistDraft(contentRef.current);
	}, [persistDraft]);

	useEffect(() => {
		savedContentRef.current = tab.savedContent;
		if (persistTimerRef.current) return;
		if (tab.content === contentRef.current && tab.dirty === dirtyRef.current) return;
		contentRef.current = tab.content;
		dirtyRef.current = tab.dirty;
		setDraftContent(tab.content);
		setIsDirty(tab.dirty);
	}, [tab.content, tab.dirty, tab.savedContent]);

	useEffect(() => {
		return () => {
			flushDraft();
			if (saveMessageTimerRef.current) {
				window.clearTimeout(saveMessageTimerRef.current);
			}
		};
	}, [flushDraft]);

	const setMessage = useCallback((message: string) => {
		setSaveMessage(message);
		if (saveMessageTimerRef.current) window.clearTimeout(saveMessageTimerRef.current);
		saveMessageTimerRef.current = window.setTimeout(() => {
			setSaveMessage("");
		}, 2200);
	}, []);

	const saveFile = useCallback(async () => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
		flushDraft();
		const nextContent = contentRef.current;
		try {
			await window.mosaic.writeFile(tab.filePath, nextContent);
			savedContentRef.current = nextContent;
			dirtyRef.current = false;
			setIsDirty(false);
			onUpdateTab(tab.id, (current) => {
				if (current.kind !== "editor") return current;
				return {
					...current,
					content: nextContent,
					savedContent: nextContent,
					dirty: false,
				};
			});
			setMessage("Saved");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Save failed");
		}
	}, [flushDraft, onUpdateTab, setMessage, tab.filePath, tab.id]);

	return (
		<div className={`pane-tab-surface ${isActive ? "active" : "inactive"}`}>
			<div className="editor-surface">
				<div className="editor-meta-row">
					<span className="editor-path" title={tab.filePath}>{tab.filePath}</span>
					<span className="editor-language-pill">{tab.language}</span>
					<button type="button" className="editor-save-button" onClick={() => void saveFile()} disabled={!isDirty}>
						Save
					</button>
				</div>
				<Suspense fallback={<div className="pdf-loading">Loading editor…</div>}>
					<MonacoEditor
						height="100%"
						language={tab.language}
						value={draftContent}
						theme={theme.kind === "light" ? "vs" : "vs-dark"}
						onChange={(value) => {
							const nextContent = value ?? "";
							contentRef.current = nextContent;
							const nextDirty = nextContent !== savedContentRef.current;
							dirtyRef.current = nextDirty;
							setDraftContent(nextContent);
							setIsDirty(nextDirty);
							if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
							persistTimerRef.current = window.setTimeout(() => {
								persistTimerRef.current = null;
								persistDraft(nextContent);
							}, 300);
						}}
						onMount={(editor, monaco) => {
							editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
								void saveFile();
							});
						}}
						options={{
							minimap: { enabled: true },
							automaticLayout: true,
							fontFamily: '"JetBrains Mono", "SF Mono", monospace',
							fontSize: 13,
							scrollBeyondLastLine: false,
							wordWrap: "on",
							quickSuggestions: true,
						}}
					/>
				</Suspense>
				{saveMessage ? <div className="editor-save-message">{saveMessage}</div> : null}
			</div>
		</div>
	);
}

function MarkdownTabSurface({
	tab,
	onUpdateTab,
	isActive,
}: {
	tab: Extract<PaneTabModel, { kind: "markdown" }>;
	onUpdateTab: (tabId: string, updater: (tab: PaneTabModel) => PaneTabModel) => void;
	isActive: boolean;
}) {
	const editorRootRef = useRef<HTMLDivElement | null>(null);
	const editorRef = useRef<{ destroy: () => Promise<unknown> } | null>(null);
	const onUpdateTabRef = useRef(onUpdateTab);
	const markdownContentRef = useRef(tab.content);
	const savedContentRef = useRef(tab.savedContent);
	const markdownDirtyRef = useRef(tab.dirty);
	const persistTimerRef = useRef<number | null>(null);
	const [isDirty, setIsDirty] = useState(tab.dirty);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [initError, setInitError] = useState<string | null>(null);

	useEffect(() => {
		onUpdateTabRef.current = onUpdateTab;
	}, [onUpdateTab]);

	const persistMarkdownDraft = useCallback((nextContent: string) => {
		onUpdateTabRef.current(tab.id, (current) => {
			if (current.kind !== "markdown") return current;
			const nextDirty = nextContent !== current.savedContent;
			if (current.content === nextContent && current.dirty === nextDirty) return current;
			return {
				...current,
				content: nextContent,
				dirty: nextDirty,
			};
		});
	}, [tab.id]);

	const flushMarkdownDraft = useCallback(() => {
		if (persistTimerRef.current) {
			window.clearTimeout(persistTimerRef.current);
			persistTimerRef.current = null;
		}
		persistMarkdownDraft(markdownContentRef.current);
	}, [persistMarkdownDraft]);

	useEffect(() => {
		savedContentRef.current = tab.savedContent;
		if (persistTimerRef.current) return;
		if (tab.content === markdownContentRef.current && tab.dirty === markdownDirtyRef.current) return;
		markdownContentRef.current = tab.content;
		markdownDirtyRef.current = tab.dirty;
		setIsDirty(tab.dirty);
	}, [tab.content, tab.dirty, tab.savedContent]);

	const saveMarkdown = useCallback(async () => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
		flushMarkdownDraft();
		try {
			const nextContent = markdownContentRef.current;
			await window.mosaic.writeFile(tab.filePath, nextContent);
			savedContentRef.current = nextContent;
			markdownDirtyRef.current = false;
			setIsDirty(false);
			onUpdateTabRef.current(tab.id, (current) => {
				if (current.kind !== "markdown") return current;
				return {
					...current,
					content: nextContent,
					savedContent: nextContent,
					dirty: false,
				};
			});
			setSaveMessage(`Saved ${new Date().toLocaleTimeString()}`);
		} catch (error) {
			setSaveMessage(error instanceof Error ? error.message : "Failed to save file.");
		}
	}, [flushMarkdownDraft, tab.filePath, tab.id]);

	useEffect(() => {
		const root = editorRootRef.current;
		if (!root) return;
		let disposed = false;
		setInitError(null);
		root.innerHTML = "";

		void (async () => {
			try {
				const [{ Editor, defaultValueCtx, rootCtx }, { commonmark }, { listener, listenerCtx }, { nord }] = await Promise.all([
					import("@milkdown/core"),
					import("@milkdown/preset-commonmark"),
					import("@milkdown/plugin-listener"),
					import("@milkdown/theme-nord"),
				]);
				if (disposed) return;

				const editor = Editor.make()
					.use(commonmark)
					.use(listener)
					.config(nord)
					.config((ctx) => {
						ctx.set(rootCtx, root);
						ctx.set(defaultValueCtx, markdownContentRef.current);
						ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
							markdownContentRef.current = markdown;
							const nextDirty = markdown !== savedContentRef.current;
							markdownDirtyRef.current = nextDirty;
							setIsDirty(nextDirty);
							if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
							persistTimerRef.current = window.setTimeout(() => {
								persistTimerRef.current = null;
								persistMarkdownDraft(markdown);
							}, 300);
						});
					});

				await editor.create();
				if (disposed) {
					await editor.destroy();
					return;
				}
				editorRef.current = editor;
			} catch (error) {
				if (disposed) return;
				setInitError(error instanceof Error ? error.message : "Failed to initialize markdown editor.");
			}
		})();

		return () => {
			disposed = true;
			flushMarkdownDraft();
			const current = editorRef.current;
			editorRef.current = null;
			if (current) void current.destroy();
		};
	}, [flushMarkdownDraft, persistMarkdownDraft, tab.id]);

	useEffect(() => {
		if (!saveMessage) return;
		const timer = window.setTimeout(() => setSaveMessage(null), 1400);
		return () => window.clearTimeout(timer);
	}, [saveMessage]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
			const root = editorRootRef.current;
			if (!root) return;
			if (!root.contains(document.activeElement)) return;
			event.preventDefault();
			void saveMarkdown();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [saveMarkdown]);

	return (
		<div className={`pane-tab-surface ${isActive ? "active" : "inactive"} tw-flex tw-min-h-0 tw-flex-1`}>
			<div className="markdown-surface milkdown-surface tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
				<div className="markdown-meta-row" title={tab.filePath}>
					<span className="editor-path">{tab.filePath}</span>
					<button type="button" className="editor-save-button" onClick={() => void saveMarkdown()} disabled={!isDirty}>
						Save
					</button>
				</div>
				<div ref={editorRootRef} className="milkdown-editor-root" />
				{initError ? <div className="editor-save-message">{initError}</div> : null}
				{saveMessage ? <div className="editor-save-message">{saveMessage}</div> : null}
			</div>
		</div>
	);
}

function ImageTabSurface({ tab, isActive }: { tab: ImageTabModel; isActive: boolean }) {
	const [scale, setScale] = useState(1);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const [imageSrc, setImageSrc] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

	useEffect(() => {
		let cancelled = false;
		setImageSrc(null);
		setLoadError(null);

		void (async () => {
			if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
			try {
				const fileUrl = window.mosaic.filePathToUrl(tab.filePath);
				if (cancelled) return;
				setImageSrc(fileUrl);
			} catch (error) {
				if (cancelled) return;
				setLoadError(error instanceof Error ? error.message : "Failed to load image.");
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [tab.filePath]);

	return (
		<div className={`pane-tab-surface ${isActive ? "active" : "inactive"} media-surface tw-flex tw-min-h-0 tw-flex-1 tw-flex-col`}>
			<div className="editor-meta-row">
				<span className="editor-path" title={tab.filePath}>{tab.filePath}</span>
				<button type="button" className="editor-save-button" onClick={() => setScale((s) => Math.max(0.2, s - 0.1))}>-</button>
				<button
					type="button"
					className="editor-save-button"
					onClick={() => {
						setScale(1);
						setOffset({ x: 0, y: 0 });
					}}
				>
					Reset
				</button>
				<button type="button" className="editor-save-button" onClick={() => setScale((s) => Math.min(8, s + 0.1))}>+</button>
			</div>
			<div
				className="media-canvas"
				onWheel={(event) => {
					event.preventDefault();
					setScale((current) => Math.min(8, Math.max(0.2, current + (event.deltaY < 0 ? 0.08 : -0.08))));
				}}
				onMouseDown={(event) => {
					if (event.button !== 0) return;
					panRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
				}}
				onMouseMove={(event) => {
					const panState = panRef.current;
					if (!panState) return;
					setOffset({ x: panState.originX + (event.clientX - panState.startX), y: panState.originY + (event.clientY - panState.startY) });
				}}
				onMouseUp={() => {
					panRef.current = null;
				}}
				onMouseLeave={() => {
					panRef.current = null;
				}}
			>
				{imageSrc ? (
					<img
						src={imageSrc}
						alt={tab.title}
						className="media-image"
						style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
						draggable={false}
					/>
				) : (
					<div className="pdf-loading">{loadError ?? "Loading image…"}</div>
				)}
			</div>
		</div>
	);
}

function PdfTabSurface({ tab, isActive }: { tab: PdfTabModel; isActive: boolean }) {
	const [numPages, setNumPages] = useState(0);
	const [pageNumber, setPageNumber] = useState(1);
	const [scale, setScale] = useState(1);
	const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null);
	const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
	const [pdfComponents, setPdfComponents] = useState<null | {
		Document: (props: Record<string, unknown>) => JSX.Element;
		Page: (props: Record<string, unknown>) => JSX.Element;
	}>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const reactPdf = await import("react-pdf");
				reactPdf.pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
				if (cancelled) return;
				setPdfComponents({
					Document: reactPdf.Document as unknown as (props: Record<string, unknown>) => JSX.Element,
					Page: reactPdf.Page as unknown as (props: Record<string, unknown>) => JSX.Element,
				});
			} catch (error) {
				if (cancelled) return;
				setPdfLoadError(error instanceof Error ? error.message : "Failed to initialize PDF viewer.");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		setPdfFileUrl(null);
		setPdfLoadError(null);
		setNumPages(0);
		setPageNumber(1);

		void (async () => {
			if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
			try {
				const fileUrl = window.mosaic.filePathToUrl(tab.filePath);
				if (cancelled) return;
				setPdfFileUrl(fileUrl);
			} catch (error) {
				if (cancelled) return;
				setPdfLoadError(error instanceof Error ? error.message : "Failed to load PDF.");
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [tab.filePath]);

	const DocumentComponent = pdfComponents?.Document;
	const PageComponent = pdfComponents?.Page;

	return (
		<div className={`pane-tab-surface ${isActive ? "active" : "inactive"} media-surface tw-flex tw-min-h-0 tw-flex-1 tw-flex-col`}>
			<div className="editor-meta-row">
				<span className="editor-path" title={tab.filePath}>{tab.filePath}</span>
				<button type="button" className="editor-save-button" onClick={() => setPageNumber((current) => Math.max(1, current - 1))} disabled={pageNumber <= 1}>
					Prev
				</button>
				<span className="editor-language-pill">{pageNumber}/{numPages || "-"}</span>
				<button
					type="button"
					className="editor-save-button"
					onClick={() => setPageNumber((current) => Math.min(numPages || 1, current + 1))}
					disabled={numPages <= 0 || pageNumber >= numPages}
				>
					Next
				</button>
				<button type="button" className="editor-save-button" onClick={() => setScale((current) => Math.max(0.4, current - 0.1))}>-</button>
				<button type="button" className="editor-save-button" onClick={() => setScale((current) => Math.min(3, current + 0.1))}>+</button>
			</div>
			<div className="pdf-canvas">
				{pdfLoadError ? <div className="pdf-loading">{pdfLoadError}</div> : null}
				{!pdfLoadError && DocumentComponent && PageComponent && pdfFileUrl ? (
					<DocumentComponent
						file={pdfFileUrl}
						onLoadSuccess={({ numPages: totalPages }: { numPages: number }) => {
							setNumPages(totalPages);
							setPageNumber((current) => Math.min(Math.max(current, 1), totalPages));
						}}
						onLoadError={(error: Error) => {
							setPdfLoadError(error.message || "Failed to load PDF.");
						}}
						loading={<div className="pdf-loading">Loading PDF…</div>}
						error={<div className="pdf-loading">{pdfLoadError ?? "Failed to load PDF."}</div>}
					>
						<PageComponent pageNumber={pageNumber} scale={scale} />
					</DocumentComponent>
				) : null}
				{!pdfLoadError && (!DocumentComponent || !PageComponent || !pdfFileUrl) ? <div className="pdf-loading">Loading PDF…</div> : null}
			</div>
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
	onMoveToNewColumn,
	canMoveToNewColumn,
	onSplitVertical,
	onSplitHorizontal,
	onClose,
	onAddTab,
	onAddBrowserTab,
	onSelectTab,
	onCloseTab,
	onMoveTab,
	onDropTabToPane,
	onToggleZoom,
	onBeginShiftDrag,
	onUpdateTabMeta,
	onOpenFile,
	onUpdateTab,
}: TerminalPaneProps) {
	const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
	const [mountedTabIds, setMountedTabIds] = useState<string[]>(() => (activeTab ? [activeTab.id] : []));
	const [tabDropActive, setTabDropActive] = useState(false);
	const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
	const [paneBodyDropActive, setPaneBodyDropActive] = useState(false);
	const [paneBodyDropPosition, setPaneBodyDropPosition] = useState<PaneDropPosition | null>(null);

	useEffect(() => {
		if (!activeTab) return;
		setMountedTabIds((current) => (current.includes(activeTab.id) ? current : [...current, activeTab.id]));
	}, [activeTab]);

	useEffect(() => {
		const nextTabIds = new Set(pane.tabs.map((tab) => tab.id));
		setMountedTabIds((current) => current.filter((tabId) => nextTabIds.has(tabId)));
	}, [pane.tabs]);

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

	const handlePaneBodyDragOver = useCallback(
		(event: ReactDragEvent<HTMLDivElement>) => {
			const payload = parseDraggedTab(event);
			if (!payload) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			setPaneBodyDropActive(true);
			setPaneBodyDropPosition(resolvePaneDropPosition(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY));
		},
		[],
	);

	const clearPaneBodyDropState = useCallback(() => {
		setPaneBodyDropActive(false);
		setPaneBodyDropPosition(null);
	}, []);

	const handlePaneBodyDrop = useCallback(
		(event: ReactDragEvent<HTMLDivElement>) => {
			const payload = parseDraggedTab(event);
			clearPaneBodyDropState();
			if (!payload) return;
			event.preventDefault();
			const position = resolvePaneDropPosition(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
			onDropTabToPane(payload.sourcePaneId, payload.tabId, position);
		},
		[clearPaneBodyDropState, onDropTabToPane],
	);

	const activeTabTitle = activeTab?.title ?? "Pane";
	const renderedTabs = activeTab
		? pane.tabs.filter((tab) => mountedTabIds.includes(tab.id) || tab.id === activeTab.id)
		: pane.tabs;

	return (
		<section
			className={`terminal-pane tw-flex tw-h-full tw-min-h-0 tw-flex-col ${focused ? "focused" : ""} ${zoomed ? "zoomed" : ""}`}
			style={{ ["--workspace-accent" as string]: accent, ["--glow-color" as string]: accent }}
			onMouseDown={onFocus}
		>
			<div className="terminal-pane-accent" />

			<div
				className="pane-header pane-header-tabs tw-flex tw-min-w-0 tw-items-center"
				onMouseDown={(event) => {
					const target = event.target as HTMLElement;
					if (target.closest("button") || target.closest('[role="button"]')) return;
					if (event.shiftKey && event.button === 0) {
						event.preventDefault();
						event.stopPropagation();
						onBeginShiftDrag(event.clientX, event.clientY);
					}
				}}
				onDoubleClick={(event) => {
					const target = event.target as HTMLElement;
					if (target.closest("button") || target.closest('[role="button"]')) return;
					onToggleZoom();
				}}
			>
				<div
					className={`pane-tab-strip tw-flex tw-min-w-0 tw-flex-1 ${tabDropActive ? "tab-drop-target" : ""}`}
					onDragOver={handleTabStripDragOver}
					onDrop={handleTabStripDrop}
					onDragLeave={(event) => {
						const nextTarget = event.relatedTarget as Node | null;
						if (nextTarget && event.currentTarget.contains(nextTarget)) return;
						setTabDropActive(false);
					}}
				>
					{pane.tabs.map((tab) => {
						const tabStatus = getTabStatus(tab);
						const tabTitle =
							"filePath" in tab
								? tab.filePath
								: tab.kind === "fileTree"
									? tab.rootPath
									: tab.kind === "browser"
										? tab.url
										: tab.title;
						return (
							<button
								key={tab.id}
								type="button"
								draggable
								className={`pane-tab-button ${tab.id === activeTab?.id ? "active" : ""} ${draggingTabId === tab.id ? "tab-dragging" : ""}`}
								onDragStart={(event) => {
									setDraggingTabId(tab.id);
									event.dataTransfer.effectAllowed = "move";
									event.dataTransfer.setData(PANE_TAB_DND_TYPE, JSON.stringify({ sourcePaneId: pane.id, tabId: tab.id }));
									event.dataTransfer.setData("text/plain", tab.id);
								}}
								onDragEnd={() => {
									setDraggingTabId(null);
									setTabDropActive(false);
									clearPaneBodyDropState();
								}}
								onClick={() => onSelectTab(tab.id)}
								title={tabTitle}
								aria-grabbed={draggingTabId === tab.id}
							>
								<span className={`status-dot pane-tab-status status-${tabStatus}`} />
								<span className="pane-tab-title">{tab.title}</span>
								{(tab.kind === "editor" || tab.kind === "markdown") && tab.dirty ? <span className="pane-tab-dirty" title="Unsaved changes">●</span> : null}
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
							</button>
						);
					})}
					<button type="button" className="pane-tab-add" onClick={onAddTab} aria-label="Open a new terminal tab">
						+
					</button>
				</div>

				<div className="pane-actions">
					{zoomed ? <span className="pane-zoom-pill">Focus</span> : null}
					<div className="pane-action-slot" data-tooltip={zoomed ? "Exit focus mode" : "Focus this pane"}>
						<button
							type="button"
							className={`pane-action-button zoom-toggle ${zoomed ? "active" : ""}`}
							onClick={onToggleZoom}
							aria-label={zoomed ? "Exit focus mode" : "Focus this pane"}
						/>
					</div>
					{canMoveToNewColumn ? (
						<div className="pane-action-slot" data-tooltip="Move pane to new right column">
							<button
								type="button"
								className="pane-action-button split-new-column"
								onClick={onMoveToNewColumn}
								aria-label={`Move ${activeTabTitle} to a new right column`}
							/>
						</div>
					) : null}
					<div className="pane-action-slot" data-tooltip="Split vertically">
						<button type="button" className="pane-action-button split-v" onClick={onSplitVertical} aria-label={`Split ${activeTabTitle} vertically`} />
					</div>
					<div className="pane-action-slot" data-tooltip="Split horizontally">
						<button type="button" className="pane-action-button split-h" onClick={onSplitHorizontal} aria-label={`Split ${activeTabTitle} horizontally`} />
					</div>
					<div className="pane-action-slot" data-tooltip="Close pane">
						<button type="button" className="pane-close-button" onClick={onClose} aria-label={`Close ${activeTabTitle}`}>
							×
						</button>
					</div>
				</div>
			</div>

			<div
				className="pane-body tw-flex-1 tw-min-h-0"
				onDragOver={handlePaneBodyDragOver}
				onDrop={handlePaneBodyDrop}
				onDragLeave={(event) => {
					const nextTarget = event.relatedTarget as Node | null;
					if (nextTarget && event.currentTarget.contains(nextTarget)) return;
					clearPaneBodyDropState();
				}}
			>
				{paneBodyDropActive ? (
					<div className="pane-drop-zones" aria-hidden="true">
						<div className={`pane-drop-zone left ${paneBodyDropPosition === "left" ? "active" : ""}`} />
						<div className={`pane-drop-zone right ${paneBodyDropPosition === "right" ? "active" : ""}`} />
						<div className={`pane-drop-zone top ${paneBodyDropPosition === "top" ? "active" : ""}`} />
						<div className={`pane-drop-zone bottom ${paneBodyDropPosition === "bottom" ? "active" : ""}`} />
						<div className={`pane-drop-zone center ${paneBodyDropPosition === "center" ? "active" : ""}`} />
					</div>
				) : null}
				{renderedTabs.map((tab) => {
					const isActiveTab = tab.id === activeTab?.id;
					if (tab.kind === "terminal") {
						return (
							<TerminalTabSurface
								key={tab.id}
								tab={tab}
								accent={accent}
								theme={theme}
								cwd={cwd}
								isActive={isActiveTab}
								onUpdateTabMeta={(patch) => onUpdateTabMeta(tab.id, patch)}
							/>
						);
					}
					if (tab.kind === "fileTree") {
						return <FileTreeTabSurface key={tab.id} tab={tab} onOpenFile={onOpenFile} isActive={isActiveTab} />;
					}
					if (tab.kind === "editor") {
						return <EditorTabSurface key={tab.id} tab={tab} theme={theme} onUpdateTab={onUpdateTab} isActive={isActiveTab} />;
					}
					if (tab.kind === "markdown") {
						return <MarkdownTabSurface key={tab.id} tab={tab} onUpdateTab={onUpdateTab} isActive={isActiveTab} />;
					}
					if (tab.kind === "image") {
						return <ImageTabSurface key={tab.id} tab={tab} isActive={isActiveTab} />;
					}
					if (tab.kind === "pdf") {
						return <PdfTabSurface key={tab.id} tab={tab} isActive={isActiveTab} />;
					}
					return <BrowserPane key={tab.id} tab={tab} theme={theme} isActive={isActiveTab} onUpdateTab={onUpdateTab} />;
				})}
			</div>
		</section>
	);
}
