import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";
import { WorkspaceView } from "./WorkspaceView";
import { FileTreeSidebar } from "./components/FileTreeSidebar";
import {
	addTabToPane,
	appendPaneToRight,
	closeTab,
	countPanes,
	createPaneNode,
	findAdjacentPaneId,
	findFirstPaneId,
	findLastPaneId,
	findPaneById,
	findTabByFilePath,
	getAllTabIds,
	moveColumnContainingPane,
	removePane,
	rehydrateLayout,
	replacePaneTabs,
	resizeFromPane,
	setActiveTab,
	splitNode,
	swapPanes,
	updatePaneTab,
} from "./core/layout";
import type { FocusDirection } from "./core/layout";
import type { LayoutNode, PaneTabModel, WorkspaceModel, WorkspaceSelection } from "./core/models";
import {
	createBrowserTab,
	createEditorTab,
	createImageTab,
	createMarkdownTab,
	createPdfTab,
	createTerminalTab,
	isImagePath,
	isMarkdownPath,
	isPdfPath,
	isTerminalTab,
	normalizeFilePath,
} from "./core/pane-tabs";
import type { MosaicTheme } from "./core/themes";
import { accentPalette, defaultThemeId, themeIds, themes } from "./core/themes";
import { getWorkspaceDisplayName, getWorkspaceTabLabel, serializeWorkspaceState } from "./core/workspaces";
import { useSessionManager } from "./core/terminal-backend-context";

type ThemeId = keyof typeof themes;
type FocusMode = "default" | "center" | "edge";
type SettingsView = "root" | "skins" | "shortcuts";

interface CommandAction {
	id: string;
	label: string;
	category: string;
	shortcut?: string;
	keywords?: string;
	disabled?: boolean;
	run: () => void;
}

const STORAGE_KEYS = {
	themeId: "mosaic.themeId",
	tabOrientation: "mosaic.tabOrientation",
	fileTreeCollapsed: "mosaic.fileTreeCollapsed",
	fileTreeWidth: "mosaic.fileTreeWidth",
	gitPaneCollapsed: "mosaic.gitPaneCollapsed",
	gitPaneWidth: "mosaic.gitPaneWidth",
	hotkeys: "mosaic.hotkeys",
	workspaces: "mosaic.workspaces",
} as const;

const LEGACY_THEME_IDS: Record<string, ThemeId> = {
	obsidian: "carbon",
	dark: "carbon",
	tron: "carbon",
	ink: "carbon",
};

type HotkeyActionId =
	| "openWorkspace"
	| "newPane"
	| "splitVertical"
	| "splitHorizontal"
	| "newTab"
	| "closeTab"
	| "nextTab"
	| "prevTab"
	| "focusLeft"
	| "focusRight"
	| "focusUp"
	| "focusDown"
	| "resizeLeft"
	| "resizeRight"
	| "resizeUp"
	| "resizeDown"
	| "previousWorkspace"
	| "nextWorkspace"
	| "openSettings"
	| "commandPalette";

const HOTKEY_DEFAULTS: Record<HotkeyActionId, string> = {
	openWorkspace: "Ctrl+Shift+KeyO",
	newPane: "Ctrl+Shift+Enter",
	splitVertical: "Ctrl+Shift+Alt+Digit5",
	splitHorizontal: "Ctrl+Shift+Alt+Quote",
	newTab: "Ctrl+Shift+KeyT",
	closeTab: "Ctrl+Shift+KeyW",
	nextTab: "Ctrl+Tab",
	prevTab: "Ctrl+Shift+Tab",
	focusLeft: "Ctrl+ArrowLeft",
	focusRight: "Ctrl+ArrowRight",
	focusUp: "Ctrl+ArrowUp",
	focusDown: "Ctrl+ArrowDown",
	resizeLeft: "Ctrl+Alt+ArrowLeft",
	resizeRight: "Ctrl+Alt+ArrowRight",
	resizeUp: "Ctrl+Alt+ArrowUp",
	resizeDown: "Ctrl+Alt+ArrowDown",
	previousWorkspace: "Alt+Shift+ArrowLeft",
	nextWorkspace: "Alt+Shift+ArrowRight",
	openSettings: "Ctrl+Comma",
	commandPalette: "Ctrl+KeyK",
};

const HOTKEY_LABELS: Record<HotkeyActionId, string> = {
	openWorkspace: "Open workspace",
	newPane: "New pane",
	splitVertical: "Split pane vertically",
	splitHorizontal: "Split pane horizontally",
	newTab: "New tab",
	closeTab: "Close tab",
	nextTab: "Next tab",
	prevTab: "Previous tab",
	focusLeft: "Focus pane left",
	focusRight: "Focus pane right",
	focusUp: "Focus pane up",
	focusDown: "Focus pane down",
	resizeLeft: "Resize pane left",
	resizeRight: "Resize pane right",
	resizeUp: "Resize pane up",
	resizeDown: "Resize pane down",
	previousWorkspace: "Previous workspace",
	nextWorkspace: "Next workspace",
	openSettings: "Open settings",
	commandPalette: "Command palette",
};

const HOTKEY_ORDER: HotkeyActionId[] = [
	"openWorkspace",
	"newPane",
	"splitVertical",
	"splitHorizontal",
	"newTab",
	"closeTab",
	"nextTab",
	"prevTab",
	"focusLeft",
	"focusRight",
	"focusUp",
	"focusDown",
	"resizeLeft",
	"resizeRight",
	"resizeUp",
	"resizeDown",
	"previousWorkspace",
	"nextWorkspace",
	"openSettings",
	"commandPalette",
];

const GIT_POLL_INTERVAL_MS = 30_000;
const FILE_TREE_MIN_WIDTH = 180;
const FILE_TREE_MAX_WIDTH = 520;
const FILE_TREE_DEFAULT_WIDTH = 270;

function fuzzyScore(value: string, query: string) {
	const source = value.toLowerCase();
	const needle = query.trim().toLowerCase();
	if (!needle) return 1;

	let score = 0;
	let sourceIndex = 0;
	let previousMatchIndex = -1;

	for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
		const char = needle[needleIndex];
		const matchIndex = source.indexOf(char, sourceIndex);
		if (matchIndex < 0) return -1;
		const isConsecutive = previousMatchIndex >= 0 && matchIndex === previousMatchIndex + 1;
		score += isConsecutive ? 4 : 2;
		score -= Math.max(0, matchIndex - sourceIndex) * 0.12;
		sourceIndex = matchIndex + 1;
		previousMatchIndex = matchIndex;
	}

	return score;
}

function CommandPalette({ open, actions, onClose }: { open: boolean; actions: CommandAction[]; onClose: () => void }) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setSelectedIndex(0);
		const rafId = window.requestAnimationFrame(() => inputRef.current?.focus());
		return () => window.cancelAnimationFrame(rafId);
	}, [open]);

	const filteredActions = useMemo(() => {
		const normalizedQuery = query.trim();
		if (!normalizedQuery) return actions;
		return actions
			.map((action) => ({
				action,
				score: Math.max(
					fuzzyScore(`${action.label} ${action.category} ${action.shortcut ?? ""}`, normalizedQuery),
					fuzzyScore(action.keywords ?? "", normalizedQuery),
				),
			}))
			.filter((entry) => entry.score >= 0)
			.sort((left, right) => right.score - left.score)
			.map((entry) => entry.action);
	}, [actions, query]);

	useEffect(() => {
		setSelectedIndex((current) => {
			if (filteredActions.length === 0) return 0;
			return Math.max(0, Math.min(current, filteredActions.length - 1));
		});
	}, [filteredActions]);

	const executeAction = useCallback(
		(action: CommandAction | undefined) => {
			if (!action || action.disabled) return;
			action.run();
			onClose();
		},
		[onClose],
	);

	if (typeof document === "undefined") return null;

	return createPortal(
		<AnimatePresence>
			{open ? (
				<>
					<button type="button" className="command-palette-scrim" onMouseDown={onClose} aria-label="Close command palette" />
					<motion.div
						className="command-palette"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
						role="dialog"
						aria-label="Command palette"
					>
						<input
							ref={inputRef}
							type="text"
							className="command-palette-input"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									setSelectedIndex((current) => (filteredActions.length === 0 ? 0 : (current + 1) % filteredActions.length));
									return;
								}
								if (event.key === "ArrowUp") {
									event.preventDefault();
									setSelectedIndex((current) => (filteredActions.length === 0 ? 0 : (current - 1 + filteredActions.length) % filteredActions.length));
									return;
								}
								if (event.key === "Enter") {
									event.preventDefault();
									executeAction(filteredActions[selectedIndex]);
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									onClose();
								}
							}}
							placeholder="Type a command"
							spellCheck={false}
						/>
						<div className="command-palette-list" role="listbox" aria-label="Commands">
							{filteredActions.length === 0 ? <div className="command-palette-empty">No matching commands</div> : null}
							{filteredActions.map((action, index) => (
								<button
									key={action.id}
									type="button"
									className={`command-palette-item ${index === selectedIndex ? "active" : ""}`}
									onMouseEnter={() => setSelectedIndex(index)}
									onClick={() => executeAction(action)}
									disabled={action.disabled}
									role="option"
									aria-selected={index === selectedIndex}
								>
									<div className="command-palette-item-main">
										<span className="command-palette-item-label">{action.label}</span>
										<span className="command-palette-item-category">{action.category}</span>
									</div>
									{action.shortcut ? <kbd className="command-palette-item-shortcut">{action.shortcut}</kbd> : null}
								</button>
							))}
						</div>
					</motion.div>
				</>
			) : null}
		</AnimatePresence>,
		document.body,
	);
}

function clampNumber(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function normalizeWorkspacePath(value: string) {
	return value.replace(/[\\/]+$/, "");
}

function serializeHotkey(event: KeyboardEvent) {
	const parts: string[] = [];
	if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	const code = event.code === "Space" ? "Space" : event.code || event.key;
	parts.push(code);
	return parts.join("+");
}

function displayHotkey(binding: string) {
	return binding
		.replace(/\+/g, " ")
		.replace(/Key/g, "")
		.replace(/Digit/g, "")
		.replace(/Arrow/g, "Arrow ")
		.replace(/\s+/g, " ")
		.trim();
}

function readStoredHotkeys() {
	if (typeof window === "undefined") return HOTKEY_DEFAULTS;
	const raw = window.localStorage.getItem(STORAGE_KEYS.hotkeys);
	if (!raw) return HOTKEY_DEFAULTS;
	try {
		const parsed = JSON.parse(raw) as Partial<Record<HotkeyActionId, string>>;
		return {
			...HOTKEY_DEFAULTS,
			...parsed,
		};
	} catch {
		return HOTKEY_DEFAULTS;
	}
}

function countBusyTabs(node: LayoutNode): number {
	if (node.type === "pane") {
		return node.pane.tabs.reduce((count, tab) => {
			if ((tab.kind === "editor" || tab.kind === "markdown") && tab.dirty) return count + 1;
			if (isTerminalTab(tab) && tab.status === "busy") return count + 1;
			return count;
		}, 0);
	}
	return countBusyTabs(node.first) + countBusyTabs(node.second);
}

function hasFileDrop(event: Pick<ReactDragEvent<HTMLElement>, "dataTransfer">) {
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function isGitStatusEqual(left: WorkspaceModel["git"], right: WorkspaceModel["git"]) {
	return (
		left.isRepo === right.isRepo &&
		left.branch === right.branch &&
		left.summary === right.summary &&
		left.dirty === right.dirty &&
		left.ahead === right.ahead &&
		left.behind === right.behind &&
		left.changeCount === right.changeCount &&
		left.rootPath === right.rootPath
	);
}

function detachFileTreeTabs(layout: LayoutNode, workspacePath: string): LayoutNode {
	if (layout.type === "pane") {
		const keptTabs = layout.pane.tabs.filter((tab) => tab.kind !== "fileTree");
		if (keptTabs.length === layout.pane.tabs.length) return layout;
		const nextTabs = keptTabs.length > 0 ? keptTabs : [createTerminalTab(workspacePath)];
		const nextActiveTabId = nextTabs.some((tab) => tab.id === layout.pane.activeTabId) ? layout.pane.activeTabId : nextTabs[0].id;
		return {
			...layout,
			pane: {
				...layout.pane,
				tabs: nextTabs,
				activeTabId: nextActiveTabId,
			},
		};
	}

	const first = detachFileTreeTabs(layout.first, workspacePath);
	const second = detachFileTreeTabs(layout.second, workspacePath);
	if (first === layout.first && second === layout.second) return layout;
	return {
		...layout,
		first,
		second,
	};
}

function getCanvasSurface(_theme: MosaicTheme) {
	return "#111317";
}

function getCanvasBorder(_theme: MosaicTheme) {
	return "#111317";
}

function buildThemeVars(theme: MosaicTheme) {
	const shellSurface = "#0B0B0E";
	return {
		["--bg-void" as string]: shellSurface,
		["--bg-surface" as string]: shellSurface,
		["--bg-well" as string]: shellSurface,
		["--border-dim" as string]: theme.borderDim,
		["--border-glow" as string]: theme.borderGlow,
		["--text-primary" as string]: theme.textPrimary,
		["--text-secondary" as string]: theme.textSecondary,
		["--text-muted" as string]: theme.textMuted,
		["--accent-amber" as string]: theme.statusWarn,
		["--accent-ember" as string]: theme.accents.ops,
		["--accent-ice" as string]: theme.accents.engineering,
		["--accent-signal" as string]: theme.statusSuccess,
		["--accent-warn" as string]: theme.statusError,
		["--surface-tint" as string]: theme.kind === "light" ? "rgba(255, 255, 255, 0.8)" : `color-mix(in srgb, ${theme.bgSurface} 80%, transparent)`,
		["--rail-tint" as string]: theme.kind === "light" ? "rgba(250, 250, 250, 0.5)" : `color-mix(in srgb, ${theme.bgSurface} 50%, transparent)`,
		["--tab-active-bg" as string]: theme.kind === "light" ? "rgba(0, 0, 0, 0.03)" : "rgba(255, 255, 255, 0.03)",
		["--bg-elevated" as string]: shellSurface,
		["--canvas-surface" as string]: getCanvasSurface(theme),
		["--canvas-border" as string]: getCanvasBorder(theme),
	};
}

function getWorkspaceAccent(index: number, workspace?: WorkspaceModel) {
	if (workspace?.accentColor) return workspace.accentColor;
	return accentPalette[index % accentPalette.length];
}

function SkinSwatch({ theme }: { theme: MosaicTheme }) {
	return (
		<span className="skin-swatch" aria-hidden="true">
			<span className="skin-swatch-band" style={{ background: theme.accents.product }} />
			<span className="skin-swatch-surface" style={{ background: theme.bgSurface }} />
			<span className="skin-swatch-well" style={{ background: theme.bgWell }} />
		</span>
	);
}


function FileTreeToggleIcon() {
	return (
		<svg className="file-tree-toggle-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path d="M1.5 3h4l1.2 1.4H14.5v8.1H1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
			<path d="M5.2 6.5h6.1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
			<path d="M5.2 8.8h4.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
		</svg>
	);
}

function GitPaneToggleIcon() {
	return (
		<svg className="file-tree-toggle-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="4" cy="4" r="1.7" stroke="currentColor" strokeWidth="1.1" />
			<circle cx="12" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.1" />
			<circle cx="4" cy="12" r="1.7" stroke="currentColor" strokeWidth="1.1" />
			<path d="M5.7 4h3a2.3 2.3 0 0 1 2.3 2.3v0" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
			<path d="M5.7 12h3a2.3 2.3 0 0 0 2.3-2.3v0" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
		</svg>
	);
}

function FloatingFileTreePane({
	rootPath,
	onOpenFile,
	onClose,
	style,
}: {
	rootPath: string;
	onOpenFile: (filePath: string) => void;
	onClose: () => void;
	style: CSSProperties;
}) {
	return (
		<section className="terminal-pane file-tree-floating-pane" style={style}>
			<div className="terminal-pane-accent" />
			<div className="pane-header pane-header-tabs file-tree-floating-header">
				<div className="pane-tab-strip">
					<button type="button" className="pane-tab-button active file-tree-floating-tab" aria-label="Files">
						<span className="status-dot pane-tab-status status-idle" />
						<span className="pane-tab-title">Files</span>
					</button>
				</div>
				<div className="pane-actions">
					<div className="pane-action-slot" data-tooltip="Close file tree">
						<button type="button" className="pane-close-button" onClick={onClose} aria-label="Close file tree">
							×
						</button>
					</div>
				</div>
			</div>
			<div className="pane-body">
				<FileTreeSidebar rootPath={rootPath} onOpenFile={onOpenFile} />
			</div>
		</section>
	);
}

function readStoredThemeId(): ThemeId {
	if (typeof window === "undefined") return defaultThemeId as ThemeId;
	const storedThemeId = window.localStorage.getItem(STORAGE_KEYS.themeId);
	const mappedThemeId = storedThemeId ? (LEGACY_THEME_IDS[storedThemeId] ?? storedThemeId) : null;
	if (mappedThemeId && mappedThemeId in themes) return mappedThemeId as ThemeId;
	return defaultThemeId as ThemeId;
}

function readStoredOrientation() {
	if (typeof window === "undefined") return "vertical" as const;
	return window.localStorage.getItem(STORAGE_KEYS.tabOrientation) === "horizontal" ? "horizontal" : "vertical";
}

function readStoredFileTreeCollapsed() {
	if (typeof window === "undefined") return false;
	return window.localStorage.getItem(STORAGE_KEYS.fileTreeCollapsed) === "true";
}

function readStoredFileTreeWidth() {
	if (typeof window === "undefined") return FILE_TREE_DEFAULT_WIDTH;
	const raw = window.localStorage.getItem(STORAGE_KEYS.fileTreeWidth);
	const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
	if (!Number.isFinite(parsed)) return FILE_TREE_DEFAULT_WIDTH;
	return clampNumber(parsed, FILE_TREE_MIN_WIDTH, FILE_TREE_MAX_WIDTH);
}

function readStoredGitPaneCollapsed() {
	if (typeof window === "undefined") return true;
	return window.localStorage.getItem(STORAGE_KEYS.gitPaneCollapsed) === "true";
}

function readStoredGitPaneWidth() {
	if (typeof window === "undefined") return FILE_TREE_DEFAULT_WIDTH;
	const raw = window.localStorage.getItem(STORAGE_KEYS.gitPaneWidth);
	const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
	if (!Number.isFinite(parsed)) return FILE_TREE_DEFAULT_WIDTH;
	return clampNumber(parsed, FILE_TREE_MIN_WIDTH, FILE_TREE_MAX_WIDTH);
}

interface WorkspaceTabItemProps {
	workspace: WorkspaceModel;
	isActive: boolean;
	accent: string;
	isRenaming: boolean;
	renameValue: string;
	onSelect: () => void;
	onClose: () => void;
	onStartRename: () => void;
	onRenameChange: (value: string) => void;
	onCommitRename: () => void;
	onCancelRename: () => void;
	onChangeAccent: (color: string) => void;
}

function WorkspaceTabItem({
	workspace,
	isActive,
	accent,
	isRenaming,
	renameValue,
	onSelect,
	onClose,
	onStartRename,
	onRenameChange,
	onCommitRename,
	onCancelRename,
	onChangeAccent,
}: WorkspaceTabItemProps) {
	const dragControls = useDragControls();
	const isDraggingRef = useRef(false);
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	const [accentPickerOpen, setAccentPickerOpen] = useState(false);
	const accentDotRef = useRef<HTMLButtonElement | null>(null);
	const accentPickerRef = useRef<HTMLDivElement | null>(null);
	const [accentPickerPosition, setAccentPickerPosition] = useState({ left: 0, top: 0 });

	useEffect(() => {
		if (!isRenaming) return;
		renameInputRef.current?.focus();
		renameInputRef.current?.select();
	}, [isRenaming]);

	useEffect(() => {
		if (!isActive && accentPickerOpen) {
			setAccentPickerOpen(false);
		}
	}, [accentPickerOpen, isActive]);

	useEffect(() => {
		if (!accentPickerOpen) return;
		const updatePosition = () => {
			const dotRect = accentDotRef.current?.getBoundingClientRect();
			if (!dotRect) return;
			setAccentPickerPosition({
				left: Math.max(8, Math.min(dotRect.left, window.innerWidth - 160)),
				top: Math.min(window.innerHeight - 8, dotRect.bottom + 6),
			});
		};
		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (accentDotRef.current?.contains(target)) return;
			if (accentPickerRef.current?.contains(target)) return;
			setAccentPickerOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setAccentPickerOpen(false);
		};
		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("mousedown", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("mousedown", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [accentPickerOpen]);

	return (
		<Reorder.Item
			value={workspace}
			dragListener={false}
			dragControls={dragControls}
			className={`workspace-tab ${isActive ? "active" : ""} ${isRenaming ? "renaming" : ""}`}
			data-workspace-tab-id={workspace.id}
			style={{ ["--workspace-accent" as string]: accent }}
			onDragStart={() => {
				if (isRenaming) return;
				isDraggingRef.current = true;
			}}
			onDragEnd={() => {
				setTimeout(() => {
					isDraggingRef.current = false;
				}, 0);
			}}
		>
			<button
				ref={accentDotRef}
				type="button"
				className="workspace-accent-dot"
				style={{ background: accent }}
				onClick={(event) => {
					event.stopPropagation();
					if (!isActive || isRenaming) {
						onSelect();
						return;
					}
					setAccentPickerOpen((current) => !current);
				}}
				onPointerDown={(event) => event.stopPropagation()}
				aria-label={isActive ? "Change workspace accent color" : `Open workspace ${getWorkspaceTabLabel(workspace)}`}
				aria-expanded={isActive ? accentPickerOpen : false}
			/>
			{accentPickerOpen
				? createPortal(
					<div
						ref={accentPickerRef}
						className="accent-picker-popup"
						style={{
							position: "fixed",
							left: accentPickerPosition.left,
							top: accentPickerPosition.top,
						}}
						onPointerDown={(event) => event.stopPropagation()}
					>
						{accentPalette.map((color) => (
							<button
								key={color}
								type="button"
								className={`accent-picker-swatch ${color.toLowerCase() === accent.toLowerCase() ? "active" : ""}`}
								style={{ background: color }}
								onClick={() => {
									onChangeAccent(color);
									setAccentPickerOpen(false);
								}}
								title={color.toUpperCase()}
								aria-label={`Accent ${color.toUpperCase()}`}
							/>
						))}
					</div>,
					document.body,
				)
				: null}
			<button
				type="button"
				className="workspace-tab-main"
				onPointerDown={(event) => {
					if (isRenaming) return;
					dragControls.start(event);
				}}
				onClick={() => {
					if (isRenaming || isDraggingRef.current) return;
					onSelect();
				}}
				onDoubleClick={() => {
					if (isDraggingRef.current) return;
					onStartRename();
				}}
			>
				<span className="workspace-tab-copy">
					{isRenaming ? (
						<input
							ref={renameInputRef}
							type="text"
							className="workspace-tab-rename-input"
							value={renameValue}
							onChange={(event) => onRenameChange(event.target.value)}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									event.currentTarget.blur();
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									onCancelRename();
								}
							}}
							onBlur={onCommitRename}
							placeholder="Workspace name"
						/>
					) : (
						<span className="workspace-tab-label" title={workspace.path}>
							{getWorkspaceTabLabel(workspace)}
						</span>
					)}
					<span className="workspace-tab-meta">{workspace.path}</span>
					{workspace.git.isRepo && workspace.git.branch ? <span className="workspace-tab-meta">{workspace.git.branch}</span> : null}
				</span>
			</button>
			<button
				type="button"
				className="workspace-tab-close"
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
				disabled={isRenaming}
				aria-label={`Close workspace ${getWorkspaceTabLabel(workspace)}`}
			>
				×
			</button>
			{isActive ? (
				<motion.div
					layoutId="tab-indicator"
					className="workspace-tab-indicator"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ type: "spring", stiffness: 250, damping: 28, opacity: { duration: 0.18 } }}
				/>
			) : null}
		</Reorder.Item>
	);
}

export function App() {
	const [activeIndex, setActiveIndex] = useState(0);
	const [themeId, setThemeId] = useState<ThemeId>(readStoredThemeId);
	const [tabOrientation, setTabOrientation] = useState<"horizontal" | "vertical">(readStoredOrientation);
	const [workspaces, setWorkspaces] = useState<WorkspaceModel[]>([]);
	const [isHydrating, setIsHydrating] = useState(true);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsView, setSettingsView] = useState<SettingsView>("root");
	const [fileTreeOpen, setFileTreeOpen] = useState(() => !readStoredFileTreeCollapsed());
	const [fileTreeWidth, setFileTreeWidth] = useState(readStoredFileTreeWidth);
	const [gitPaneOpen, setGitPaneOpen] = useState(() => !readStoredGitPaneCollapsed());
	const [gitPaneWidth, setGitPaneWidth] = useState(readStoredGitPaneWidth);
	const topSettingsButtonRef = useRef<HTMLButtonElement>(null);
	const railSettingsButtonRef = useRef<HTMLButtonElement>(null);
	const topFileTreeButtonRef = useRef<HTMLButtonElement>(null);
	const railFileTreeButtonRef = useRef<HTMLButtonElement>(null);
	const settingsPanelRef = useRef<HTMLDivElement>(null);
	const fileTreePanelRef = useRef<HTMLDivElement>(null);
	const workspacePillbarRef = useRef<HTMLDivElement>(null);
	const [settingsPanelPosition, setSettingsPanelPosition] = useState({ left: 8, top: 44, maxHeight: 520 });
	const [fileTreePanelPosition, setFileTreePanelPosition] = useState({ left: 8, top: 52, maxHeight: 520 });
	const [overviewOpen, setOverviewOpen] = useState(false);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
	const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState("");
	const [hotkeys, setHotkeys] = useState<Record<HotkeyActionId, string>>(readStoredHotkeys);
	const [capturingHotkeyId, setCapturingHotkeyId] = useState<HotkeyActionId | null>(null);
	const workspacesRef = useRef<WorkspaceModel[]>([]);
	const sessionManager = useSessionManager();

	const currentTheme = themes[themeId];
	const shellStyle = useMemo(() => buildThemeVars(currentTheme), [currentTheme]);

	useEffect(() => {
		document.documentElement.style.colorScheme = currentTheme.kind;
		document.documentElement.style.background = currentTheme.bgVoid;
	}, [currentTheme]);

	useEffect(() => {
		workspacesRef.current = workspaces;
	}, [workspaces]);

	const goTo = useCallback(
		(nextIndex: number) => {
			if (nextIndex < 0 || nextIndex >= workspaces.length || nextIndex === activeIndex) return;
			setActiveIndex(nextIndex);
		},
		[activeIndex, workspaces.length],
	);

	const updateWorkspace = useCallback((workspaceId: string, updater: (workspace: WorkspaceModel) => WorkspaceModel) => {
		setWorkspaces((current) => current.map((workspace) => (workspace.id === workspaceId ? updater(workspace) : workspace)));
	}, []);

	const removeWorkspace = useCallback(
		(workspaceId: string) => {
			const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
			if (!workspace) return;

			const busyCount = countBusyTabs(workspace.layout);
			if (busyCount > 0 && typeof window !== "undefined") {
				const label = busyCount === 1 ? "tab" : "tabs";
				const shouldClose = window.confirm(`${busyCount} ${label} have running work or unsaved changes — close anyway?`);
				if (!shouldClose) return;
			}

			setWorkspaces((current) => {
				const index = current.findIndex((w) => w.id === workspaceId);
				if (index < 0) return current;

				const workspaceToRemove = current[index];
				for (const tabId of getAllTabIds(workspaceToRemove.layout)) {
					sessionManager.closeSession(tabId);
				}

				const next = current.filter((w) => w.id !== workspaceId);
				setActiveIndex((currentActive) => {
					if (next.length === 0) return 0;
					if (currentActive >= next.length) return next.length - 1;
					if (currentActive > index) return currentActive - 1;
					return currentActive;
				});
				return next;
			});

			if (renamingWorkspaceId === workspaceId) {
				setRenamingWorkspaceId(null);
				setWorkspaceRenameDraft("");
			}
		},
		[renamingWorkspaceId, sessionManager],
	);

	const reorderWorkspaces = useCallback(
		(reordered: WorkspaceModel[]) => {
			setWorkspaces((current) => {
				const activeId = current[activeIndex]?.id;
				const nextIndex = reordered.findIndex((w) => w.id === activeId);
				if (nextIndex >= 0 && nextIndex !== activeIndex) setActiveIndex(nextIndex);
				return reordered;
			});
		},
		[activeIndex],
	);

	const openWorkspaceSelection = useCallback((selection: WorkspaceSelection) => {
		setWorkspaces((current) => {
			const layout = createPaneNode(selection.path);
			const next = [
				...current,
				{
					id: crypto.randomUUID(),
					path: selection.path,
					accentColor: accentPalette[current.length % accentPalette.length],
					git: selection.git,
					layout,
					focusedPaneId: findFirstPaneId(layout),
				},
			];
			setActiveIndex(next.length - 1);
			return next;
		});
	}, []);

	const addWorkspace = useCallback(async () => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
		const selected = await window.mosaic.pickWorkspaceDirectory();
		if (!selected) return;
		openWorkspaceSelection(selected);
	}, [openWorkspaceSelection]);

	const openWorkspacesFromPaths = useCallback(
		async (paths: string[]) => {
			if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
			const uniquePaths = [...new Set(paths.map((value) => normalizeWorkspacePath(value)).filter(Boolean))];
			for (const droppedPath of uniquePaths) {
				try {
					const inspected = await window.mosaic.inspectWorkspace(droppedPath);
					openWorkspaceSelection(inspected);
				} catch {
					// Ignore non-directory drops.
				}
			}
		},
		[openWorkspaceSelection],
	);

	const handleWorkspaceDropDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
		if (!hasFileDrop(event)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const handleWorkspaceDrop = useCallback(
		(event: ReactDragEvent<HTMLElement>) => {
			if (!hasFileDrop(event)) return;
			event.preventDefault();
			const droppedPaths = Array.from(event.dataTransfer.files)
				.map((file) => (file as File & { path?: string }).path)
				.filter((value): value is string => Boolean(value));
			if (droppedPaths.length === 0) return;
			void openWorkspacesFromPaths(droppedPaths);
		},
		[openWorkspacesFromPaths],
	);

	const startWorkspaceRename = useCallback((workspace: WorkspaceModel) => {
		setRenamingWorkspaceId(workspace.id);
		setWorkspaceRenameDraft(workspace.customName?.trim() || getWorkspaceDisplayName(workspace));
	}, []);

	const commitWorkspaceRename = useCallback(
		(workspaceId: string) => {
			const nextName = workspaceRenameDraft.trim();
			updateWorkspace(workspaceId, (workspace) => ({
				...workspace,
				customName: nextName.length > 0 ? nextName : undefined,
			}));
			setRenamingWorkspaceId(null);
			setWorkspaceRenameDraft("");
		},
		[updateWorkspace, workspaceRenameDraft],
	);

	const cancelWorkspaceRename = useCallback(() => {
		setRenamingWorkspaceId(null);
		setWorkspaceRenameDraft("");
	}, []);

	const changeWorkspaceAccent = useCallback(
		(workspaceId: string, color: string) => {
			updateWorkspace(workspaceId, (workspace) => ({
				...workspace,
				accentColor: color,
			}));
		},
		[updateWorkspace],
	);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined") {
			setIsHydrating(false);
			return;
		}

		const raw = window.localStorage.getItem(STORAGE_KEYS.workspaces);
		if (!raw) {
			setIsHydrating(false);
			return;
		}

		let stored: Array<{ id: string; path: string; customName?: string; accentColor?: string; layout?: LayoutNode; focusedPaneId?: string }> = [];
		try {
			stored = JSON.parse(raw) as Array<{ id: string; path: string; customName?: string; accentColor?: string; layout?: LayoutNode; focusedPaneId?: string }>;
		} catch {
			window.localStorage.removeItem(STORAGE_KEYS.workspaces);
			setIsHydrating(false);
			return;
		}

		Promise.all(
			stored.map(async (workspace, index) => {
				try {
					const layout = detachFileTreeTabs(rehydrateLayout(workspace.layout, workspace.path), workspace.path);
					return {
						...workspace,
						accentColor:
							typeof workspace.accentColor === "string" && workspace.accentColor.trim().length > 0
								? workspace.accentColor
								: accentPalette[index % accentPalette.length],
						git: (await window.mosaic.inspectWorkspace(workspace.path)).git,
						layout,
						focusedPaneId: workspace.focusedPaneId ?? findFirstPaneId(layout),
					};
				} catch {
					return null;
				}
			}),
		)
			.then((nextWorkspaces) => {
				const filtered = nextWorkspaces.filter((workspace): workspace is NonNullable<typeof workspace> => workspace !== null) as WorkspaceModel[];
				setWorkspaces(filtered);
				setActiveIndex((current) => Math.min(current, Math.max(filtered.length - 1, 0)));
			})
			.finally(() => {
				setIsHydrating(false);
			});
	}, []);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;

		let cancelled = false;
		let inFlight = false;
		const pollGitStatus = async () => {
			if (inFlight) return;
			const workspaceSnapshot = workspacesRef.current.map(({ id, path }) => ({ id, path }));
			if (workspaceSnapshot.length === 0) return;

			inFlight = true;
			try {
				const nextStatuses = await Promise.all(
					workspaceSnapshot.map(async (workspace) => {
						try {
							const result = await window.mosaic.inspectWorkspace(workspace.path);
							return { id: workspace.id, git: result.git };
						} catch {
							return null;
						}
					}),
				);
				if (cancelled) return;

				const statusMap = new Map(
					nextStatuses
						.filter((item): item is { id: string; git: WorkspaceModel["git"] } => item !== null)
						.map((item) => [item.id, item.git]),
				);
				if (statusMap.size === 0) return;

				setWorkspaces((current) => {
					let changed = false;
					const next = current.map((workspace) => {
						const nextGit = statusMap.get(workspace.id);
						if (!nextGit || isGitStatusEqual(workspace.git, nextGit)) return workspace;
						changed = true;
						return {
							...workspace,
							git: nextGit,
						};
					});
					return changed ? next : current;
				});
			} finally {
				inFlight = false;
			}
		};

		void pollGitStatus();
		const intervalId = window.setInterval(() => {
			void pollGitStatus();
		}, GIT_POLL_INTERVAL_MS);
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void pollGitStatus();
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [workspaces.length]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(STORAGE_KEYS.themeId, themeId);
	}, [themeId]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(STORAGE_KEYS.tabOrientation, tabOrientation);
	}, [tabOrientation]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(STORAGE_KEYS.fileTreeCollapsed, fileTreeOpen ? "false" : "true");
	}, [fileTreeOpen]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(STORAGE_KEYS.fileTreeWidth, String(fileTreeWidth));
	}, [fileTreeWidth]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(STORAGE_KEYS.gitPaneCollapsed, gitPaneOpen ? "false" : "true");
	}, [gitPaneOpen]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(STORAGE_KEYS.gitPaneWidth, String(gitPaneWidth));
	}, [gitPaneWidth]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(STORAGE_KEYS.hotkeys, JSON.stringify(hotkeys));
	}, [hotkeys]);

	useEffect(() => {
		if (typeof window === "undefined" || isHydrating) return;
		window.localStorage.setItem(STORAGE_KEYS.workspaces, JSON.stringify(serializeWorkspaceState(workspaces)));
	}, [isHydrating, workspaces]);

	useEffect(() => {
		document.documentElement.dataset.theme = currentTheme.kind;
	}, [currentTheme.kind]);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.mosaic?.updateTitleBarOverlay !== "function") return;
		const canvasSurface = getCanvasSurface(currentTheme);
		window.mosaic.updateTitleBarOverlay({
			backgroundColor: canvasSurface,
			overlayColor: canvasSurface,
			symbolColor: currentTheme.kind === "light" ? "#3f3f46" : "#a1a1aa",
		});
	}, [currentTheme]);

	useEffect(() => {
		if (!renamingWorkspaceId) return;
		const exists = workspaces.some((workspace) => workspace.id === renamingWorkspaceId);
		if (!exists) {
			setRenamingWorkspaceId(null);
			setWorkspaceRenameDraft("");
		}
	}, [renamingWorkspaceId, workspaces]);

	const closeSettings = useCallback(() => {
		setSettingsOpen(false);
		setSettingsView("root");
		setCapturingHotkeyId(null);
	}, []);

	const openCommandPalette = useCallback(() => {
		setCommandPaletteOpen(true);
	}, []);

	const closeCommandPalette = useCallback(() => {
		setCommandPaletteOpen(false);
	}, []);

	useEffect(() => {
		if (!capturingHotkeyId) return;
		const handleCapture = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				setCapturingHotkeyId(null);
				return;
			}
			if (!["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
				setHotkeys((current) => ({
					...current,
					[capturingHotkeyId]: serializeHotkey(event),
				}));
				setCapturingHotkeyId(null);
			}
		};
		window.addEventListener("keydown", handleCapture, true);
		return () => window.removeEventListener("keydown", handleCapture, true);
	}, [capturingHotkeyId]);

	const closeFileTree = useCallback(() => {
		setFileTreeOpen(false);
	}, []);

	const updateSettingsPanelPosition = useCallback(() => {
		if (typeof window === "undefined") return;
		const maxHeight = Math.max(320, window.innerHeight - 24);
		setSettingsPanelPosition((current) => (Math.abs(current.maxHeight - maxHeight) < 0.5 ? current : { ...current, maxHeight }));
	}, []);

	const updateFileTreePanelPosition = useCallback(() => {
		if (typeof window === "undefined") return;

		const margin = 8;
		const gap = 8;
		const anchorButton = tabOrientation === "horizontal" ? topFileTreeButtonRef.current : railFileTreeButtonRef.current;
		const buttonRect = anchorButton?.getBoundingClientRect();
		const panelRect = fileTreePanelRef.current?.getBoundingClientRect();
		const panelWidth = panelRect?.width ?? 270;
		const panelHeight = panelRect?.height ?? 520;

		let left = buttonRect ? buttonRect.left : margin;
		left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - panelWidth - margin));

		let top = buttonRect ? buttonRect.bottom + gap : 52;
		top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - panelHeight - margin));
		const maxHeight = Math.max(320, window.innerHeight - top - margin);

		setFileTreePanelPosition((current) => {
			if (
				Math.abs(current.left - left) < 0.5 &&
				Math.abs(current.top - top) < 0.5 &&
				Math.abs(current.maxHeight - maxHeight) < 0.5
			) {
				return current;
			}
			return { left, top, maxHeight };
		});
	}, [tabOrientation]);

	useLayoutEffect(() => {
		if (!settingsOpen) return;
		updateSettingsPanelPosition();
		const rafId = window.requestAnimationFrame(updateSettingsPanelPosition);
		const handleResize = () => updateSettingsPanelPosition();
		window.addEventListener("resize", handleResize);
		return () => {
			window.cancelAnimationFrame(rafId);
			window.removeEventListener("resize", handleResize);
		};
	}, [settingsOpen, settingsView, tabOrientation, workspaces.length, updateSettingsPanelPosition]);

	useLayoutEffect(() => {
		if (!fileTreeOpen) return;
		updateFileTreePanelPosition();
		const rafId = window.requestAnimationFrame(updateFileTreePanelPosition);
		const handleResize = () => updateFileTreePanelPosition();
		window.addEventListener("resize", handleResize);
		return () => {
			window.cancelAnimationFrame(rafId);
			window.removeEventListener("resize", handleResize);
		};
	}, [fileTreeOpen, tabOrientation, activeIndex, updateFileTreePanelPosition]);

	const activeWorkspace = workspaces[activeIndex];
	const focusedPaneId = activeWorkspace ? activeWorkspace.focusedPaneId ?? findFirstPaneId(activeWorkspace.layout) : null;
	const focusedPane = activeWorkspace && focusedPaneId ? findPaneById(activeWorkspace.layout, focusedPaneId) : null;

	useEffect(() => {
		if (!activeWorkspace) {
			setOverviewOpen(false);
			setFileTreeOpen(false);
		}
	}, [activeWorkspace]);

	useEffect(() => {
		if (typeof window === "undefined" || tabOrientation !== "horizontal") return;
		const container = workspacePillbarRef.current;
		const activeTab = container?.querySelector<HTMLElement>(`.workspace-tab[data-workspace-tab-id="${activeWorkspace?.id ?? ""}"]`);
		if (!container || !activeTab) return;
		const targetLeft = activeTab.offsetLeft - (container.clientWidth - activeTab.clientWidth) / 2;
		container.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
	}, [activeWorkspace?.id, tabOrientation, workspaces.length]);

	const openSettings = useCallback((view: SettingsView = "root") => {
		setSettingsOpen(true);
		setSettingsView(view);
	}, []);

		const toggleOverview = useCallback(() => {
		setOverviewOpen((current) => !current);
	}, []);

	const focusPane = useCallback(
		(workspaceId: string, paneId: string) => {
			updateWorkspace(workspaceId, (workspace) => ({ ...workspace, focusedPaneId: paneId }));
		},
		[updateWorkspace],
	);

	const toggleFileTree = useCallback(() => {
		if (!activeWorkspace) return;
		setFileTreeOpen((current) => !current);
	}, [activeWorkspace]);

	const toggleGitPane = useCallback(() => {
		if (!activeWorkspace) return;
		setGitPaneOpen((current) => !current);
	}, [activeWorkspace]);

	const addPaneToActiveWorkspace = useCallback(() => {
		if (!activeWorkspace) return;
		const nextLayout = appendPaneToRight(activeWorkspace.layout, activeWorkspace.path);
		const insertedPaneId = findLastPaneId(nextLayout);
		updateWorkspace(activeWorkspace.id, (workspace) => ({
			...workspace,
			layout: nextLayout,
			focusedPaneId: insertedPaneId,
		}));
	}, [activeWorkspace, updateWorkspace]);

	const addBrowserPaneToActiveWorkspace = useCallback(() => {
		if (!activeWorkspace) return;
		const nextLayout = appendPaneToRight(activeWorkspace.layout, activeWorkspace.path);
		const insertedPaneId = findLastPaneId(nextLayout);
		const browserTab = createBrowserTab("about:blank");
		const layoutWithBrowser = replacePaneTabs(nextLayout, insertedPaneId, [browserTab], browserTab.id);
		updateWorkspace(activeWorkspace.id, (workspace) => ({
			...workspace,
			layout: layoutWithBrowser,
			focusedPaneId: insertedPaneId,
		}));
	}, [activeWorkspace, updateWorkspace]);

	const openFileFromTree = useCallback(
		async (workspaceId: string, filePath: string) => {
			if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
			const normalizedPath = normalizeFilePath(filePath);
			const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
			if (!workspace) return;

			const existingTab = findTabByFilePath(workspace.layout, normalizedPath);
			if (existingTab) {
				updateWorkspace(workspaceId, (currentWorkspace) => ({
					...currentWorkspace,
					layout: setActiveTab(currentWorkspace.layout, existingTab.paneId, existingTab.tabId),
					focusedPaneId: existingTab.paneId,
				}));
				return;
			}

			let tab = null as PaneTabModel | null;
			if (isImagePath(normalizedPath)) {
				tab = createImageTab(normalizedPath);
			} else if (isPdfPath(normalizedPath)) {
				tab = createPdfTab(normalizedPath);
			} else {
				let content: string;
				try {
					content = await window.mosaic.readFile(normalizedPath);
				} catch (error) {
					const message = error instanceof Error ? error.message : "Failed to read file.";
					window.alert(message);
					return;
				}
				tab = isMarkdownPath(normalizedPath)
					? createMarkdownTab(normalizedPath, content)
					: createEditorTab(normalizedPath, content);
			}

			updateWorkspace(workspaceId, (currentWorkspace) => {
				const duplicate = findTabByFilePath(currentWorkspace.layout, normalizedPath);
				if (duplicate) {
					return {
						...currentWorkspace,
						layout: setActiveTab(currentWorkspace.layout, duplicate.paneId, duplicate.tabId),
						focusedPaneId: duplicate.paneId,
					};
				}

				const nextLayout = appendPaneToRight(currentWorkspace.layout, currentWorkspace.path);
				const targetPaneId = findLastPaneId(nextLayout);
				const layoutWithFile = replacePaneTabs(nextLayout, targetPaneId, [tab], tab.id);
				return {
					...currentWorkspace,
					layout: layoutWithFile,
					focusedPaneId: targetPaneId,
				};
			});
		},
		[updateWorkspace],
	);

	const splitFocusedPane = useCallback(
		(direction: "horizontal" | "vertical") => {
			if (!activeWorkspace || !focusedPaneId) return;
			const nextLayout = splitNode(activeWorkspace.layout, focusedPaneId, direction, activeWorkspace.path);
			updateWorkspace(activeWorkspace.id, (workspace) => ({
				...workspace,
				layout: nextLayout,
				focusedPaneId,
			}));
		},
		[activeWorkspace, focusedPaneId, updateWorkspace],
	);

	const addTabToFocusedPane = useCallback(() => {
		if (!activeWorkspace || !focusedPaneId) return;
		const nextLayout = addTabToPane(activeWorkspace.layout, focusedPaneId, activeWorkspace.path);
		updateWorkspace(activeWorkspace.id, (workspace) => ({
			...workspace,
			layout: nextLayout,
			focusedPaneId,
		}));
	}, [activeWorkspace, focusedPaneId, updateWorkspace]);

	const closeFocusedTab = useCallback(() => {
		if (!activeWorkspace || !focusedPaneId || !focusedPane) return;
		const activeTab = focusedPane.tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? focusedPane.tabs[0];
		if (!activeTab) return;
		if ((activeTab.kind === "editor" || activeTab.kind === "markdown") && activeTab.dirty) {
			const shouldClose = window.confirm(`Discard unsaved changes in ${activeTab.title}?`);
			if (!shouldClose) return;
		}

		if (focusedPane.tabs.length <= 1) {
			if (isTerminalTab(activeTab)) {
				sessionManager.closeSession(activeTab.id);
			}
			if (countPanes(activeWorkspace.layout) <= 1) {
				removeWorkspace(activeWorkspace.id);
				return;
			}
			const nextLayout = removePane(activeWorkspace.layout, focusedPaneId) ?? activeWorkspace.layout;
			updateWorkspace(activeWorkspace.id, (workspace) => ({
				...workspace,
				layout: nextLayout,
				focusedPaneId: findFirstPaneId(nextLayout),
			}));
			return;
		}

		if (isTerminalTab(activeTab)) {
			sessionManager.closeSession(activeTab.id);
		}
		const nextLayout = closeTab(activeWorkspace.layout, focusedPaneId, activeTab.id, activeWorkspace.path);
		updateWorkspace(activeWorkspace.id, (workspace) => ({
			...workspace,
			layout: nextLayout,
			focusedPaneId,
		}));
	}, [activeWorkspace, focusedPane, focusedPaneId, removeWorkspace, sessionManager, updateWorkspace]);

	const stepFocusedTab = useCallback(
		(delta: number) => {
			if (!activeWorkspace || !focusedPaneId || !focusedPane || focusedPane.tabs.length < 2) return;
			const currentIndex = focusedPane.tabs.findIndex((tab) => tab.id === focusedPane.activeTabId);
			const nextIndex = (currentIndex + delta + focusedPane.tabs.length) % focusedPane.tabs.length;
			const nextLayout = setActiveTab(activeWorkspace.layout, focusedPaneId, focusedPane.tabs[nextIndex].id);
			updateWorkspace(activeWorkspace.id, (workspace) => ({
				...workspace,
				layout: nextLayout,
				focusedPaneId,
			}));
		},
		[activeWorkspace, focusedPane, focusedPaneId, updateWorkspace],
	);

	const updateWorkspaceTab = useCallback(
		(workspaceId: string, paneId: string, tabId: string, updater: (tab: PaneTabModel) => PaneTabModel) => {
			updateWorkspace(workspaceId, (workspace) => ({
				...workspace,
				layout: updatePaneTab(workspace.layout, paneId, tabId, updater),
			}));
		},
		[updateWorkspace],
	);

	const refreshWorkspaceGit = useCallback(async (workspaceId: string) => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
		const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
		if (!workspace) return;
		try {
			const inspected = await window.mosaic.inspectWorkspace(workspace.path);
			updateWorkspace(workspaceId, (current) => (isGitStatusEqual(current.git, inspected.git) ? current : { ...current, git: inspected.git }));
		} catch {
			// noop
		}
	}, [updateWorkspace]);

	const moveFocus = useCallback(
		(direction: FocusDirection) => {
			if (!activeWorkspace || !focusedPaneId) return;
			const nextPaneId = findAdjacentPaneId(activeWorkspace.layout, focusedPaneId, direction);
			if (nextPaneId) {
				updateWorkspace(activeWorkspace.id, (workspace) => ({ ...workspace, focusedPaneId: nextPaneId }));
			}
		},
		[activeWorkspace, focusedPaneId, updateWorkspace],
	);

	const resizeFocusedPane = useCallback(
		(direction: FocusDirection) => {
			if (!activeWorkspace || !focusedPaneId) return;
			const nextLayout = resizeFromPane(activeWorkspace.layout, focusedPaneId, direction, 0.05);
			updateWorkspace(activeWorkspace.id, (workspace) => ({
				...workspace,
				layout: nextLayout,
				focusedPaneId,
			}));
		},
		[activeWorkspace, focusedPaneId, updateWorkspace],
	);

	const moveFocusedColumn = useCallback(
		(delta: -1 | 1) => {
			if (!activeWorkspace || !focusedPaneId) return;
			const nextLayout = moveColumnContainingPane(activeWorkspace.layout, focusedPaneId, delta);
			updateWorkspace(activeWorkspace.id, (workspace) => ({
				...workspace,
				layout: nextLayout,
				focusedPaneId,
			}));
		},
		[activeWorkspace, focusedPaneId, updateWorkspace],
	);

	const commandActions = useMemo<CommandAction[]>(() => {
		const workspaceActions = workspaces.map((workspace, index) => ({
			id: `workspace:${workspace.id}`,
			label: `Switch to ${getWorkspaceTabLabel(workspace)}`,
			category: "Workspace",
			keywords: `${workspace.path} ${workspace.git.branch ?? ""}`,
			run: () => goTo(index),
		}));

		const skinActions = themeIds.map((id) => ({
			id: `theme:${id}`,
			label: `Use ${themes[id].name}`,
			category: "Settings",
			keywords: `theme skin ${themes[id].name}`,
			run: () => setThemeId(id as ThemeId),
		}));

		const canRunPaneAction = Boolean(activeWorkspace && focusedPaneId);

		return [
			...workspaceActions,
			...skinActions,
			{
				id: "pane:new-terminal",
				label: "New terminal pane",
				category: "Pane",
				shortcut: displayHotkey(hotkeys.newPane),
				run: addPaneToActiveWorkspace,
				disabled: !activeWorkspace,
			},
			{
				id: "pane:new-browser",
				label: "New browser pane",
				category: "Pane",
				run: addBrowserPaneToActiveWorkspace,
				disabled: !activeWorkspace,
			},
			{
				id: "pane:split-vertical",
				label: "Split focused pane vertically",
				category: "Pane",
				shortcut: displayHotkey(hotkeys.splitVertical),
				run: () => splitFocusedPane("vertical"),
				disabled: !canRunPaneAction,
			},
			{
				id: "pane:split-horizontal",
				label: "Split focused pane horizontally",
				category: "Pane",
				shortcut: displayHotkey(hotkeys.splitHorizontal),
				run: () => splitFocusedPane("horizontal"),
				disabled: !canRunPaneAction,
			},
			{
				id: "pane:close-focused",
				label: "Close focused pane tab",
				category: "Pane",
				shortcut: displayHotkey(hotkeys.closeTab),
				run: closeFocusedTab,
				disabled: !canRunPaneAction,
			},
			{
				id: "pane:toggle-zoom",
				label: "Toggle focused pane zoom",
				category: "Pane",
				shortcut: "Ctrl Shift M",
				run: () => {
					window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", code: "KeyM", ctrlKey: true, shiftKey: true, bubbles: true }));
				},
				disabled: !canRunPaneAction,
			},
			{
				id: "workspace:file-tree",
				label: "Open file tree",
				category: "Workspace",
				run: () => setFileTreeOpen(true),
				disabled: !activeWorkspace,
			},
			{
				id: "settings:open",
				label: "Open settings",
				category: "Settings",
				shortcut: displayHotkey(hotkeys.openSettings),
				run: () => openSettings(),
			},
			{
				id: "palette:open",
				label: "Toggle command palette",
				category: "Navigation",
				shortcut: displayHotkey(hotkeys.commandPalette),
				run: () => {
					setCommandPaletteOpen((current) => !current);
				},
			},
		];
	}, [
		activeWorkspace,
		addBrowserPaneToActiveWorkspace,
		addPaneToActiveWorkspace,
		closeFocusedTab,
		focusedPaneId,
		goTo,
		openSettings,
		splitFocusedPane,
		hotkeys,
		workspaces,
	]);

	useEffect(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			const combo = serializeHotkey(event);
			if (combo === hotkeys.commandPalette) {
				event.preventDefault();
				if (commandPaletteOpen) closeCommandPalette();
				else openCommandPalette();
				return;
			}

			if (event.key === "Escape" && renamingWorkspaceId) {
				event.preventDefault();
				cancelWorkspaceRename();
				return;
			}

			if (event.key === "Escape" && commandPaletteOpen) {
				event.preventDefault();
				closeCommandPalette();
				return;
			}

			if (event.key === "Escape" && settingsOpen) {
				event.preventDefault();
				closeSettings();
				return;
			}

			if (event.key === "Escape" && fileTreeOpen) {
				event.preventDefault();
				closeFileTree();
				return;
			}

			if (commandPaletteOpen) return;

			const target = event.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				target?.isContentEditable;

			if (combo === hotkeys.openWorkspace) {
				event.preventDefault();
				void addWorkspace();
				return;
			}

			if (combo === hotkeys.newPane) {
				event.preventDefault();
				addPaneToActiveWorkspace();
				return;
			}

			if (combo === hotkeys.newTab) {
				event.preventDefault();
				addTabToFocusedPane();
				return;
			}

			if (combo === hotkeys.closeTab) {
				event.preventDefault();
				closeFocusedTab();
				return;
			}

			if (combo === hotkeys.nextTab) {
				event.preventDefault();
				stepFocusedTab(1);
				return;
			}

			if (combo === hotkeys.prevTab) {
				event.preventDefault();
				stepFocusedTab(-1);
				return;
			}

			if (combo === hotkeys.openSettings) {
				event.preventDefault();
				openSettings();
				return;
			}

			if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === "Space") {
				event.preventDefault();
				toggleOverview();
				return;
			}

			if (combo === hotkeys.splitVertical) {
				event.preventDefault();
				splitFocusedPane("vertical");
				return;
			}

			if (combo === hotkeys.splitHorizontal) {
				event.preventDefault();
				splitFocusedPane("horizontal");
				return;
			}

			if (combo === hotkeys.focusLeft || combo === hotkeys.focusRight || combo === hotkeys.focusUp || combo === hotkeys.focusDown) {
				event.preventDefault();
				const map: Record<string, FocusDirection> = {
					[hotkeys.focusLeft]: "left",
					[hotkeys.focusRight]: "right",
					[hotkeys.focusUp]: "up",
					[hotkeys.focusDown]: "down",
				};
				moveFocus(map[combo]);
				return;
			}

			if (!event.ctrlKey && !event.altKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
				event.preventDefault();
				moveFocusedColumn(event.key === "ArrowLeft" ? -1 : 1);
				return;
			}

			if (combo === hotkeys.resizeLeft || combo === hotkeys.resizeRight || combo === hotkeys.resizeUp || combo === hotkeys.resizeDown) {
				event.preventDefault();
				const map: Record<string, FocusDirection> = {
					[hotkeys.resizeLeft]: "left",
					[hotkeys.resizeRight]: "right",
					[hotkeys.resizeUp]: "up",
					[hotkeys.resizeDown]: "down",
				};
				resizeFocusedPane(map[combo]);
				return;
			}

			if (combo === hotkeys.previousWorkspace) {
				event.preventDefault();
				goTo(activeIndex - 1);
				return;
			}
			if (combo === hotkeys.nextWorkspace) {
				event.preventDefault();
				goTo(activeIndex + 1);
				return;
			}

			if (isEditableTarget) return;

			if (tabOrientation === "vertical") {
				if (event.key === "ArrowUp") goTo(activeIndex - 1);
				if (event.key === "ArrowDown") goTo(activeIndex + 1);
				return;
			}

			if (event.key === "ArrowLeft") goTo(activeIndex - 1);
			if (event.key === "ArrowRight") goTo(activeIndex + 1);
		};

		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	}, [
		activeIndex,
		addPaneToActiveWorkspace,
		addTabToFocusedPane,
		addWorkspace,
		cancelWorkspaceRename,
		closeCommandPalette,
		closeFileTree,
		closeFocusedTab,
		closeSettings,
		commandPaletteOpen,
		fileTreeOpen,
		goTo,
		moveFocus,
		moveFocusedColumn,
		openCommandPalette,
		openSettings,
		renamingWorkspaceId,
		resizeFocusedPane,
		settingsOpen,
		splitFocusedPane,
		stepFocusedTab,
		tabOrientation,
		toggleOverview,
		hotkeys,
	]);

	const activeWorkspaceAccent = activeWorkspace ? getWorkspaceAccent(activeIndex, activeWorkspace) : currentTheme.accents.product;
	const appShellStyle = useMemo(
		() => ({
			...shellStyle,
			["--workspace-accent" as string]: activeWorkspaceAccent,
		}),
		[shellStyle, activeWorkspaceAccent],
	);
	const isVertical = tabOrientation === "vertical";
	const hasActiveWorkspace = Boolean(activeWorkspace);
	const workspaceTabs = (
		<Reorder.Group
			as="nav"
			axis={isVertical ? "y" : "x"}
			values={workspaces}
			onReorder={reorderWorkspaces}
			className={`workspace-tabs ${isVertical ? "vertical" : ""}`}
			onDragOver={handleWorkspaceDropDragOver}
			onDrop={handleWorkspaceDrop}
			aria-label="Workspaces"
		>
			{workspaces.map((workspace, index) => {
				const isRenaming = renamingWorkspaceId === workspace.id;
				return (
					<WorkspaceTabItem
						key={workspace.id}
						workspace={workspace}
						isActive={index === activeIndex}
						accent={getWorkspaceAccent(index, workspace)}
						isRenaming={isRenaming}
						renameValue={isRenaming ? workspaceRenameDraft : ""}
						onSelect={() => {
							if (renamingWorkspaceId && renamingWorkspaceId !== workspace.id) {
								commitWorkspaceRename(renamingWorkspaceId);
							}
							goTo(index);
						}}
						onClose={() => removeWorkspace(workspace.id)}
						onStartRename={() => startWorkspaceRename(workspace)}
						onRenameChange={setWorkspaceRenameDraft}
						onCommitRename={() => commitWorkspaceRename(workspace.id)}
						onCancelRename={cancelWorkspaceRename}
						onChangeAccent={(color) => changeWorkspaceAccent(workspace.id, color)}
					/>
				);
			})}
		</Reorder.Group>
	);

	const fileTreePanel = null;

	const settingsPanel = settingsOpen && typeof document !== "undefined"
		? createPortal(
			<>
				<button
					type="button"
					className="settings-scrim"
					onMouseDown={(event) => {
						event.preventDefault();
						closeSettings();
					}}
					aria-label="Close settings"
				/>
				<div
					ref={settingsPanelRef}
					className="settings-panel centered"
					style={{
						maxHeight: `${Math.max(320, settingsPanelPosition.maxHeight)}px`,
					}}
					role="dialog"
					aria-label="Settings"
				>
					{settingsView !== "root" ? (
						<button type="button" className="settings-back" onClick={() => setSettingsView("root")}>
							← Back
						</button>
					) : null}

					{settingsView === "root" ? (
						<>
							<div className="settings-panel-header">Settings</div>
							<button type="button" className="settings-item" onClick={() => setSettingsView("skins")}>
								<span className="settings-item-icon">◑</span>
								<span className="settings-item-copy">Skins</span>
								<span className="settings-item-chevron">›</span>
							</button>
							<button type="button" className="settings-item" onClick={() => setSettingsView("shortcuts")}>
								<span className="settings-item-icon">⌨</span>
								<span className="settings-item-copy">Shortcuts</span>
								<span className="settings-item-chevron">›</span>
							</button>
						</>
					) : null}

					{settingsView === "skins" ? (
						<div className="settings-section">
							<div className="settings-item-label">Skin</div>
							<div className="skin-options" role="list">
								{themeIds.map((id) => (
									<button
										key={id}
										type="button"
										role="listitem"
										className={`skin-option ${themeId === id ? "active" : ""}`}
										onClick={() => {
											setThemeId(id as ThemeId);
											closeSettings();
										}}
									>
										<SkinSwatch theme={themes[id]} />
										<span className="skin-option-copy">{themes[id].name}</span>
										{themeId === id ? <span className="skin-option-check">✓</span> : null}
									</button>
								))}
							</div>
						</div>
					) : null}

					{settingsView === "shortcuts" ? (
						<div className="settings-section">
							<div className="settings-item-label">Shortcuts</div>
							<div className="shortcut-list">
								{HOTKEY_ORDER.map((id) => (
									<div key={id} className="shortcut-item">
										<span className="shortcut-action">{HOTKEY_LABELS[id]}</span>
										<button
											type="button"
											className={`shortcut-keys ${capturingHotkeyId === id ? "capturing" : ""}`}
											onClick={() => setCapturingHotkeyId(id)}
										>
											{capturingHotkeyId === id ? "Press keys…" : displayHotkey(hotkeys[id])}
										</button>
									</div>
								))}
							</div>
							<button
								type="button"
								className="settings-item"
								onClick={() => {
									setHotkeys(HOTKEY_DEFAULTS);
									setCapturingHotkeyId(null);
								}}
							>
								<span className="settings-item-icon">↺</span>
								<span className="settings-item-copy">Reset to defaults</span>
							</button>
						</div>
					) : null}
				</div>
			</>,
			document.body,
		)
		: null;

	return (
		<div className="app-shell tw-relative tw-flex tw-h-full tw-w-full tw-flex-col" style={appShellStyle}>
			{tabOrientation === "horizontal" ? (
				<header className="topbar titlebar-drag tw-select-none">
					<div className="topbar-component-row">
						<div className="topbar-side topbar-side-leading">
							<button
								ref={topFileTreeButtonRef}
								type="button"
								className={`icon-button file-tree-toggle ${fileTreeOpen ? "active" : ""}`}
								onClick={toggleFileTree}
								disabled={!hasActiveWorkspace}
								aria-label={fileTreeOpen ? "Hide file tree" : "Show file tree"}
							>
								<FileTreeToggleIcon />
							</button>
						</div>
						<div className="workspace-switcher-shell">
							<div className="workspace-switcher">
								<div ref={workspacePillbarRef} className="workspace-pillbar">{workspaceTabs}</div>
								<button type="button" className="icon-button workspace-topbar-add" onClick={addWorkspace} aria-label="Open directory">
									+
								</button>
							</div>
						</div>
						<div className="topbar-side topbar-side-trailing">
							<div className="settings-anchor settings-anchor-trailing topbar-trailing-settings">
								<button
									type="button"
									className={`icon-button git-pane-toggle ${gitPaneOpen ? "active" : ""}`}
									onClick={toggleGitPane}
									disabled={!hasActiveWorkspace}
									aria-label={gitPaneOpen ? "Hide git pane" : "Show git pane"}
								>
									<GitPaneToggleIcon />
								</button>
								<button
									ref={topSettingsButtonRef}
									type="button"
									className={`icon-button ${settingsOpen ? "active" : ""}`}
									onClick={() => {
										if (settingsOpen) {
											closeSettings();
											return;
										}
										openSettings();
									}}
									aria-label="Open settings"
								>
									⚙
								</button>
							</div>
						</div>
					</div>
				</header>
			) : null}

			{tabOrientation === "vertical" ? <div className="titlebar-strip titlebar-drag" /> : null}
			<div className="workspace-main tw-flex tw-min-h-0 tw-min-w-0 tw-flex-1">
				<div className={`workspace-shell tw-flex tw-min-h-0 tw-min-w-0 tw-flex-1 ${tabOrientation === "vertical" ? "with-vertical-tabs" : ""}`}>
					{tabOrientation === "vertical" && workspaces.length > 0 ? (
						<aside className="workspace-rail tw-flex tw-min-h-0 tw-flex-col" onDragOver={handleWorkspaceDropDragOver} onDrop={handleWorkspaceDrop}>
							<div className="workspace-rail-header">
								<button
									ref={railFileTreeButtonRef}
									type="button"
									className={`icon-button file-tree-toggle ${fileTreeOpen ? "active" : ""}`}
									onClick={toggleFileTree}
									disabled={!hasActiveWorkspace}
									aria-label={fileTreeOpen ? "Hide file tree" : "Show file tree"}
								>
									<FileTreeToggleIcon />
								</button>
								<button
									type="button"
									className={`icon-button git-pane-toggle ${gitPaneOpen ? "active" : ""}`}
									onClick={toggleGitPane}
									disabled={!hasActiveWorkspace}
									aria-label={gitPaneOpen ? "Hide git pane" : "Show git pane"}
								>
									<GitPaneToggleIcon />
								</button>
								<div className="settings-anchor">
									<button
										ref={railSettingsButtonRef}
										type="button"
										className={`icon-button ${settingsOpen ? "active" : ""}`}
										onClick={() => {
											if (settingsOpen) {
												closeSettings();
												return;
											}
											openSettings();
										}}
										aria-label="Open settings"
									>
										⚙
									</button>
								</div>
								<button type="button" className="icon-button workspace-tab-add" onClick={addWorkspace} aria-label="Open directory">
									+
								</button>
								<span className="rail-label">Workspaces</span>
							</div>
							<div className="workspace-rail-body tw-min-h-0 tw-flex-1">{workspaceTabs}</div>
						</aside>
					) : null}
					<div className="workspace-stage tw-relative tw-flex-1 tw-overflow-hidden">
						<AnimatePresence initial={false} mode="wait">
							{workspaces.length === 0 ? (
								<motion.div
									key="empty"
									className="empty-state"
									onDragOver={handleWorkspaceDropDragOver}
									onDrop={handleWorkspaceDrop}
									initial={{ opacity: 0, scale: 0.995, y: 4 }}
									animate={{ opacity: 1, scale: 1, y: 0 }}
									exit={{ opacity: 0, scale: 0.995, y: -2 }}
									transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
								>
									<div className="empty-state-hero">
										<h1 className="empty-state-brand">Mosaic</h1>
										<p className="empty-state-tagline">Open a directory to begin.</p>
										<button type="button" className="empty-state-cta" onClick={addWorkspace}>
											Open Directory
										</button>
									</div>
								</motion.div>
							) : activeWorkspace ? (
								<motion.div
									key={activeWorkspace.id}
									className="workspace-panel"
									initial={{ opacity: 0, scale: 0.995, y: 2 }}
									animate={{ opacity: 1, scale: 1, y: 0 }}
									exit={{ opacity: 0, scale: 0.995, y: -1 }}
									transition={{ duration: 0.19, ease: [0.22, 1, 0.36, 1] }}
								>
									<WorkspaceView
										workspace={activeWorkspace}
										accent={activeWorkspaceAccent}
										theme={currentTheme}
										focusMode="center"
										fileTreeOpen={fileTreeOpen}
										fileTreeWidth={fileTreeWidth}
										onFileTreeWidthChange={setFileTreeWidth}
										gitPaneOpen={gitPaneOpen}
										gitPaneWidth={gitPaneWidth}
										onGitPaneWidthChange={setGitPaneWidth}
										onRefreshWorkspaceGit={() => refreshWorkspaceGit(activeWorkspace.id)}
										overviewOpen={overviewOpen}
										onExitOverview={() => setOverviewOpen(false)}
										onOpenOverview={() => setOverviewOpen(true)}
										onAddPane={addPaneToActiveWorkspace}
										onAddBrowserPane={addBrowserPaneToActiveWorkspace}
										onOpenFile={(filePath) => void openFileFromTree(activeWorkspace.id, filePath)}
										onUpdateTab={(paneId, tabId, updater) => updateWorkspaceTab(activeWorkspace.id, paneId, tabId, updater)}
										focusedPaneId={activeWorkspace.focusedPaneId}
										onFocusPane={(paneId) => focusPane(activeWorkspace.id, paneId)}
										onSwapPanes={(sourcePaneId, targetPaneId) =>
											updateWorkspace(activeWorkspace.id, (workspace) => ({
												...workspace,
												layout: swapPanes(workspace.layout, sourcePaneId, targetPaneId),
												focusedPaneId: sourcePaneId,
											}))
										}
										onSplitPane={(paneId, direction) =>
											updateWorkspace(activeWorkspace.id, (workspace) => ({
												...workspace,
												layout: splitNode(workspace.layout, paneId, direction, workspace.path),
												focusedPaneId: paneId,
											}))
										}
										onUpdateLayout={(layout) =>
											updateWorkspace(activeWorkspace.id, (workspace) => ({
												...workspace,
												layout,
												focusedPaneId:
													workspace.focusedPaneId && findPaneById(layout, workspace.focusedPaneId)
														? workspace.focusedPaneId
														: findFirstPaneId(layout),
											}))
										}
									/>
								</motion.div>
							) : null}
						</AnimatePresence>
					</div>
				</div>
			</div>

			{fileTreePanel}
			{settingsPanel}
			<CommandPalette open={commandPaletteOpen} actions={commandActions} onClose={closeCommandPalette} />
		</div>
	);
}
