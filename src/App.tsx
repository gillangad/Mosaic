import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { createPortal } from "react-dom";
import { WorkspaceView } from "./WorkspaceView";
import { addTabToPane, appendPaneToRight, closeTab, createPaneNode, findAdjacentPaneId, findFirstPaneId, findLastPaneId, findPaneById, getAllTabIds, rehydrateLayout, resizeFromPane, setActiveTab, splitNode, swapPanes } from "./core/layout";
import type { FocusDirection } from "./core/layout";
import type { LayoutNode, WorkspaceModel, WorkspaceSelection } from "./core/models";
import type { MosaicTheme } from "./core/themes";
import { defaultThemeId, themeIds, themes } from "./core/themes";
import { getWorkspaceDisplayName, getWorkspaceTabLabel, serializeWorkspaceState } from "./core/workspaces";
import { useSessionManager } from "./core/terminal-backend-context";

type ThemeId = keyof typeof themes;
type FocusMode = "default" | "center" | "edge";
type SettingsView = "root" | "skins" | "shortcuts";

interface ShortcutDefinition {
	action: string;
	keys: string;
}

const STORAGE_KEYS = {
	themeId: "mosaic.themeId",
	tabOrientation: "mosaic.tabOrientation",
	workspaces: "mosaic.workspaces",
} as const;

const LEGACY_THEME_IDS: Record<string, ThemeId> = {
	obsidian: "carbon",
	dark: "carbon",
	tron: "carbon",
	ink: "carbon",
};

const ACCENT_KEYS = ["product", "engineering", "research", "ops"] as const;
const SHORTCUTS: ShortcutDefinition[] = [
	{ action: "Open workspace", keys: "Ctrl Shift O" },
	{ action: "New pane", keys: "Ctrl Shift Enter" },
	{ action: "Split pane vertically", keys: "Ctrl Shift Alt %" },
	{ action: "Split pane horizontally", keys: 'Ctrl Shift Alt "' },
	{ action: "New tab", keys: "Ctrl Shift T" },
	{ action: "Close tab", keys: "Ctrl Shift W" },
	{ action: "Next tab", keys: "Ctrl Tab" },
	{ action: "Previous tab", keys: "Ctrl Shift Tab" },
	{ action: "Focus pane", keys: "Ctrl Shift Arrow" },
	{ action: "Resize pane", keys: "Ctrl Alt Arrow" },
	{ action: "Toggle pane zoom", keys: "Ctrl Shift M" },
	{ action: "Previous workspace", keys: "Alt Shift Left / Up" },
	{ action: "Next workspace", keys: "Alt Shift Right / Down" },
	{ action: "Open settings", keys: "Ctrl ," },
];

const GIT_POLL_INTERVAL_MS = 30_000;

function normalizeWorkspacePath(value: string) {
	return value.replace(/[\\/]+$/, "");
}

function countBusyTabs(node: LayoutNode): number {
	if (node.type === "pane") {
		return node.pane.tabs.reduce((count, tab) => count + (tab.status === "busy" ? 1 : 0), 0);
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

function buildThemeVars(theme: MosaicTheme) {
	return {
		["--bg-void" as string]: theme.bgVoid,
		["--bg-surface" as string]: theme.bgSurface,
		["--bg-well" as string]: theme.bgWell,
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
		["--bg-elevated" as string]: theme.kind === "light"
			? `color-mix(in srgb, ${theme.bgSurface} 97%, ${theme.textPrimary})`
			: `color-mix(in srgb, ${theme.bgSurface} 85%, ${theme.textPrimary})`,
	};
}

function getWorkspaceAccent(theme: MosaicTheme, index: number) {
	return theme.accents[ACCENT_KEYS[index % ACCENT_KEYS.length]];
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
}: WorkspaceTabItemProps) {
	const dragControls = useDragControls();
	const isDraggingRef = useRef(false);
	const renameInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!isRenaming) return;
		renameInputRef.current?.focus();
		renameInputRef.current?.select();
	}, [isRenaming]);

	return (
		<Reorder.Item
			value={workspace}
			dragListener={false}
			dragControls={dragControls}
			className={`workspace-tab ${isActive ? "active" : ""} ${isRenaming ? "renaming" : ""}`}
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
	const topSettingsButtonRef = useRef<HTMLButtonElement>(null);
	const railSettingsButtonRef = useRef<HTMLButtonElement>(null);
	const settingsPanelRef = useRef<HTMLDivElement>(null);
	const [settingsPanelPosition, setSettingsPanelPosition] = useState({ left: 8, top: 44, maxHeight: 520 });
	const [overviewOpen, setOverviewOpen] = useState(false);
	const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
	const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState("");
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
				const label = busyCount === 1 ? "terminal" : "terminals";
				const shouldClose = window.confirm(`${busyCount} ${label} busy — close anyway?`);
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

		let stored: Array<{ id: string; path: string; customName?: string; layout?: LayoutNode; focusedPaneId?: string }> = [];
		try {
			stored = JSON.parse(raw) as Array<{ id: string; path: string; customName?: string; layout?: LayoutNode; focusedPaneId?: string }>;
		} catch {
			window.localStorage.removeItem(STORAGE_KEYS.workspaces);
			setIsHydrating(false);
			return;
		}

		Promise.all(
			stored.map(async (workspace) => {
				try {
					const layout = rehydrateLayout(workspace.layout, workspace.path);
					return {
						...workspace,
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
		if (typeof window === "undefined" || isHydrating) return;
		window.localStorage.setItem(STORAGE_KEYS.workspaces, JSON.stringify(serializeWorkspaceState(workspaces)));
	}, [isHydrating, workspaces]);

	useEffect(() => {
		document.documentElement.dataset.theme = currentTheme.kind;
	}, [currentTheme.kind]);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.mosaic?.updateTitleBarOverlay !== "function") return;
		window.mosaic.updateTitleBarOverlay({
			backgroundColor: currentTheme.bgVoid,
			overlayColor: currentTheme.bgVoid,
			symbolColor: currentTheme.kind === "light" ? "#3f3f46" : "#a1a1aa",
		});
	}, [currentTheme.bgVoid, currentTheme.kind]);

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
	}, []);

	const updateSettingsPanelPosition = useCallback(() => {
		if (typeof window === "undefined") return;

		const margin = 8;
		const gap = 6;
		const anchorButton = tabOrientation === "horizontal" ? topSettingsButtonRef.current : railSettingsButtonRef.current;
		const buttonRect = anchorButton?.getBoundingClientRect();
		const panelRect = settingsPanelRef.current?.getBoundingClientRect();
		const panelWidth = panelRect?.width ?? 260;
		const panelHeight = panelRect?.height ?? 380;

		let left = buttonRect ? buttonRect.left : margin;
		left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - panelWidth - margin));

		let top = buttonRect ? buttonRect.bottom + gap : 44;
		if (buttonRect) {
			const fitsBelow = buttonRect.bottom + gap + panelHeight <= window.innerHeight - margin;
			const aboveTop = buttonRect.top - gap - panelHeight;
			if (!fitsBelow && aboveTop >= margin) {
				top = aboveTop;
			}
		}
		top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - panelHeight - margin));

		const maxHeight = Math.max(320, window.innerHeight - top - margin);
		setSettingsPanelPosition((current) => {
			if (Math.abs(current.left - left) < 0.5 && Math.abs(current.top - top) < 0.5 && Math.abs(current.maxHeight - maxHeight) < 0.5) {
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

	const activeWorkspace = workspaces[activeIndex];
	const focusedPaneId = activeWorkspace ? activeWorkspace.focusedPaneId ?? findFirstPaneId(activeWorkspace.layout) : null;
	const focusedPane = activeWorkspace && focusedPaneId ? findPaneById(activeWorkspace.layout, focusedPaneId) : null;

	useEffect(() => {
		if (!activeWorkspace) setOverviewOpen(false);
	}, [activeWorkspace]);

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
		sessionManager.closeSession(focusedPane.activeTabId);
		const nextLayout = closeTab(activeWorkspace.layout, focusedPaneId, focusedPane.activeTabId, activeWorkspace.path);
		updateWorkspace(activeWorkspace.id, (workspace) => ({
			...workspace,
			layout: nextLayout,
			focusedPaneId,
		}));
	}, [activeWorkspace, focusedPane, focusedPaneId, sessionManager, updateWorkspace]);

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

	useEffect(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && renamingWorkspaceId) {
				event.preventDefault();
				cancelWorkspaceRename();
				return;
			}

			if (event.key === "Escape" && settingsOpen) {
				event.preventDefault();
				closeSettings();
				return;
			}

			const target = event.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				target?.isContentEditable;

			if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === "KeyO") {
				event.preventDefault();
				void addWorkspace();
				return;
			}

			if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === "Enter") {
				event.preventDefault();
				addPaneToActiveWorkspace();
				return;
			}

			if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === "KeyT") {
				event.preventDefault();
				addTabToFocusedPane();
				return;
			}

			if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === "KeyW") {
				event.preventDefault();
				closeFocusedTab();
				return;
			}

			if (event.ctrlKey && event.code === "Tab") {
				event.preventDefault();
				stepFocusedTab(event.shiftKey ? -1 : 1);
				return;
			}

			if (event.ctrlKey && event.code === "Comma") {
				event.preventDefault();
				openSettings();
				return;
			}

			if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === "Space") {
				event.preventDefault();
				toggleOverview();
				return;
			}

			if (event.ctrlKey && event.shiftKey && event.altKey && event.code === "Digit5") {
				event.preventDefault();
				splitFocusedPane("vertical");
				return;
			}

			if (event.ctrlKey && event.shiftKey && event.altKey && event.code === "Quote") {
				event.preventDefault();
				splitFocusedPane("horizontal");
				return;
			}

			if (event.ctrlKey && event.shiftKey && !event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
				event.preventDefault();
				const dir = event.key.replace("Arrow", "").toLowerCase() as FocusDirection;
				moveFocus(dir);
				return;
			}

			if (event.ctrlKey && event.altKey && !event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
				event.preventDefault();
				const dir = event.key.replace("Arrow", "").toLowerCase() as FocusDirection;
				resizeFocusedPane(dir);
				return;
			}

			if (event.altKey && event.shiftKey && !event.ctrlKey) {
				if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
					event.preventDefault();
					goTo(activeIndex - 1);
					return;
				}
				if (event.key === "ArrowRight" || event.key === "ArrowDown") {
					event.preventDefault();
					goTo(activeIndex + 1);
					return;
				}
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
		closeFocusedTab,
		closeSettings,
		goTo,
		moveFocus,
		openSettings,
		renamingWorkspaceId,
		resizeFocusedPane,
		settingsOpen,
		splitFocusedPane,
		stepFocusedTab,
		tabOrientation,
		toggleOverview,
	]);

	const activeWorkspaceAccent = activeWorkspace ? getWorkspaceAccent(currentTheme, activeIndex) : currentTheme.accents.product;
	const appShellStyle = useMemo(
		() => ({
			...shellStyle,
			["--workspace-accent" as string]: activeWorkspaceAccent,
		}),
		[shellStyle, activeWorkspaceAccent],
	);
	const isVertical = tabOrientation === "vertical";
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
						accent={getWorkspaceAccent(currentTheme, index)}
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
					/>
				);
			})}
			<button type="button" className="icon-button workspace-tab-add" onClick={addWorkspace} aria-label="Open directory">
				+
			</button>
		</Reorder.Group>
	);

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
					className={`settings-panel ${tabOrientation === "vertical" ? "rail" : "topbar"}`}
					style={{
						left: `${settingsPanelPosition.left}px`,
						top: `${settingsPanelPosition.top}px`,
						maxHeight: `${settingsPanelPosition.maxHeight}px`,
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
							<button
								type="button"
								className="settings-item"
								onClick={() => {
									setTabOrientation((current) => (current === "horizontal" ? "vertical" : "horizontal"));
									closeSettings();
								}}
							>
								<span className="settings-item-icon">⊟</span>
								<span className="settings-item-copy">{tabOrientation === "horizontal" ? "Vertical Tabs" : "Top Tabs"}</span>
							</button>
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
								{SHORTCUTS.map((shortcut) => (
									<div key={shortcut.action} className="shortcut-item">
										<span className="shortcut-action">{shortcut.action}</span>
										<kbd className="shortcut-keys">{shortcut.keys}</kbd>
									</div>
								))}
							</div>
						</div>
					) : null}
				</div>
			</>,
			document.body,
		)
		: null;

	return (
		<div className="app-shell" style={appShellStyle}>
			{tabOrientation === "horizontal" ? (
				<header className="topbar titlebar-drag">
					<div className="settings-anchor settings-anchor-leading topbar-leading-settings">
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
					{workspaceTabs}
				</header>
			) : null}

			{tabOrientation === "vertical" ? <div className="titlebar-strip titlebar-drag" /> : null}
			<div className={`workspace-shell ${tabOrientation === "vertical" ? "with-vertical-tabs" : ""}`}>
				{tabOrientation === "vertical" && workspaces.length > 0 ? (
					<aside className="workspace-rail" onDragOver={handleWorkspaceDropDragOver} onDrop={handleWorkspaceDrop}>
						<div className="workspace-rail-header">
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
							<span className="rail-label">Workspaces</span>
						</div>
						<div className="workspace-rail-body">{workspaceTabs}</div>
					</aside>
				) : null}
				<div className="workspace-stage">
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
									overviewOpen={overviewOpen}
									onExitOverview={() => setOverviewOpen(false)}
									onOpenOverview={() => setOverviewOpen(true)}
									onAddPane={addPaneToActiveWorkspace}
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

			{settingsPanel}
		</div>
	);
}
