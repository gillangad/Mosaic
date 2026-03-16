import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent as ReactDragEvent,
	type MouseEvent as ReactMouseEvent,
} from "react";
import MonacoEditor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { SerializeAddon } from "xterm-addon-serialize";
import { WebLinksAddon } from "xterm-addon-web-links";
import { useSessionManager, useTerminalBackend } from "../core/terminal-backend-context";
import type { EditorTabModel, FileTreeTabModel, PaneModel, PaneTabModel, TerminalTabModel } from "../core/models";
import { getTabStatus, isEditorTab } from "../core/pane-tabs";
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
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onMoveTab: (sourcePaneId: string, tabId: string, targetPaneId: string) => void;
	onToggleZoom: () => void;
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

function isExternalUrl(value: string) {
	return /^(https?:|mailto:|tel:|#)/i.test(value);
}

function normalizeSeparators(value: string) {
	return value.replace(/\\/g, "/");
}

function dirname(filePath: string) {
	const normalized = normalizeSeparators(filePath);
	const index = normalized.lastIndexOf("/");
	return index <= 0 ? normalized : normalized.slice(0, index);
}

function resolveLocalPath(baseFilePath: string, target: string) {
	const [targetPath, hash = ""] = target.split("#", 2);
	const baseDir = dirname(baseFilePath);
	const initial = targetPath.startsWith("/")
		? targetPath
		: `${normalizeSeparators(baseDir)}/${targetPath}`;
	const parts = initial.split("/");
	const resolved: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (resolved.length > 0 && resolved.at(-1) !== "..") resolved.pop();
			continue;
		}
		resolved.push(part);
	}
	const joined = resolved.join("/");
	const hasDrive = /^[a-zA-Z]:/.test(joined);
	const absolute = hasDrive ? joined : `/${joined}`;
	return hash ? `${absolute}#${hash}` : absolute;
}

function toFileUrl(filePath: string) {
	const normalized = normalizeSeparators(filePath);
	if (/^[a-zA-Z]:\//.test(normalized)) {
		return `file:///${encodeURI(normalized)}`;
	}
	return `file://${encodeURI(normalized.startsWith("/") ? normalized : `/${normalized}`)}`;
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
		let titleDisposable: { dispose: () => void } | null = null;
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

				titleDisposable = terminal.onTitleChange((nextTitle) => {
					if (nextTitle) updateTabMetaRef.current({ title: nextTitle });
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
			searchAddonRef.current?.findNext(value, {
				decorations: {
					matchOverviewRuler: "#888",
					activeMatchColorOverviewRuler: "#fff",
					matchBackground: "#555",
					activeMatchBackground: "#e8a634",
				},
			});
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

function FileTreeTabSurface({ tab, onOpenFile }: { tab: FileTreeTabModel; onOpenFile: (filePath: string) => void }) {
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
		<div className="pane-tab-surface active">
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
}: {
	tab: EditorTabModel;
	theme: MosaicTheme;
	onUpdateTab: (tabId: string, updater: (tab: PaneTabModel) => PaneTabModel) => void;
}) {
	const contentRef = useRef(tab.content);
	const [saveMessage, setSaveMessage] = useState(tab.message ?? "");
	const saveMessageTimerRef = useRef<number | null>(null);

	useEffect(() => {
		contentRef.current = tab.content;
	}, [tab.content]);

	useEffect(() => {
		setSaveMessage(tab.message ?? "");
	}, [tab.message]);

	useEffect(() => {
		return () => {
			if (saveMessageTimerRef.current) {
				window.clearTimeout(saveMessageTimerRef.current);
			}
		};
	}, []);

	const setMessage = useCallback(
		(message: string) => {
			setSaveMessage(message);
			onUpdateTab(tab.id, (current) => (current.kind === "editor" ? { ...current, message } : current));
			if (saveMessageTimerRef.current) window.clearTimeout(saveMessageTimerRef.current);
			saveMessageTimerRef.current = window.setTimeout(() => {
				onUpdateTab(tab.id, (current) => (current.kind === "editor" ? { ...current, message: undefined } : current));
				setSaveMessage("");
			}, 2200);
		},
		[onUpdateTab, tab.id],
	);

	const saveFile = useCallback(async () => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
		const nextContent = contentRef.current;
		try {
			await window.mosaic.writeFile(tab.filePath, nextContent);
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
	}, [onUpdateTab, setMessage, tab.filePath, tab.id]);

	return (
		<div className="pane-tab-surface active">
			<div className="editor-surface">
				<div className="editor-meta-row">
					<span className="editor-path" title={tab.filePath}>{tab.filePath}</span>
					<span className="editor-language-pill">{tab.language}</span>
					<button type="button" className="editor-save-button" onClick={() => void saveFile()} disabled={!tab.dirty}>
						Save
					</button>
				</div>
				<MonacoEditor
					height="100%"
					language={tab.language}
					value={tab.content}
					theme={theme.kind === "light" ? "vs" : "vs-dark"}
					onChange={(value) => {
						const nextContent = value ?? "";
						contentRef.current = nextContent;
						onUpdateTab(tab.id, (current) => {
							if (current.kind !== "editor") return current;
							return {
								...current,
								content: nextContent,
								dirty: nextContent !== current.savedContent,
							};
						});
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
				{saveMessage ? <div className="editor-save-message">{saveMessage}</div> : null}
			</div>
		</div>
	);
}

function MarkdownTabSurface({
	tab,
	onOpenFile,
}: {
	tab: Extract<PaneTabModel, { kind: "markdown" }>;
	onOpenFile: (filePath: string) => void;
}) {
	const baseDir = useMemo(() => dirname(tab.filePath), [tab.filePath]);

	return (
		<div className="pane-tab-surface active">
			<div className="markdown-surface">
				<div className="markdown-meta-row" title={tab.filePath}>{tab.filePath}</div>
				<div className="markdown-content markdown-body">
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						rehypePlugins={[rehypeHighlight]}
						components={{
							a: ({ href, children, ...props }) => {
								if (!href) return <a {...props}>{children}</a>;
								if (isExternalUrl(href)) {
									return (
										<a href={href} target="_blank" rel="noreferrer" {...props}>
											{children}
										</a>
									);
								}
								const localPath = resolveLocalPath(`${baseDir}/_`, href);
								return (
									<a
										href={toFileUrl(localPath)}
										onClick={(event) => {
											event.preventDefault();
											onOpenFile(localPath);
										}}
										{...props}
									>
										{children}
									</a>
								);
							},
							img: ({ src, alt, ...props }) => {
								if (!src) return null;
								const resolvedSrc = isExternalUrl(src) ? src : toFileUrl(resolveLocalPath(`${baseDir}/_`, src));
								return <img src={resolvedSrc} alt={alt ?? ""} {...props} />;
							},
						}}
					>
						{tab.content}
					</ReactMarkdown>
				</div>
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
	onSelectTab,
	onCloseTab,
	onMoveTab,
	onToggleZoom,
	onUpdateTabMeta,
	onOpenFile,
	onUpdateTab,
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

	const activeTabTitle = activeTab?.title ?? "Pane";

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
					{pane.tabs.map((tab) => {
						const tabStatus = getTabStatus(tab);
						const tabTitle = tab.kind === "editor" || tab.kind === "markdown" ? tab.filePath : tab.kind === "fileTree" ? tab.rootPath : tab.title;
						return (
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
								title={tabTitle}
								aria-grabbed={draggingTabId === tab.id}
							>
								<span className={`status-dot pane-tab-status status-${tabStatus}`} />
								<span className="pane-tab-title">{tab.title}</span>
								{isEditorTab(tab) && tab.dirty ? <span className="pane-tab-dirty" title="Unsaved changes">●</span> : null}
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

			<div className="pane-body">
				{activeTab.kind === "terminal" ? (
					<TerminalTabSurface
						key={activeTab.id}
						tab={activeTab}
						accent={accent}
						theme={theme}
						cwd={cwd}
						isActive
						onUpdateTabMeta={(patch) => onUpdateTabMeta(activeTab.id, patch)}
					/>
				) : null}
				{activeTab.kind === "fileTree" ? <FileTreeTabSurface tab={activeTab} onOpenFile={onOpenFile} /> : null}
				{activeTab.kind === "editor" ? <EditorTabSurface tab={activeTab} theme={theme} onUpdateTab={onUpdateTab} /> : null}
				{activeTab.kind === "markdown" ? <MarkdownTabSurface tab={activeTab} onOpenFile={onOpenFile} /> : null}
			</div>
		</section>
	);
}
