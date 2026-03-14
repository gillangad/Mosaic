import { motion, Reorder, useDragControls } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceView } from "./WorkspaceView";
import { addTabToPane, appendPaneToRight, closeTab, createPaneNode, findAdjacentPaneId, findFirstPaneId, findLastPaneId, findPaneById, rehydrateLayout, resizeFromPane, setActiveTab, splitNode } from "./core/layout";
import type { FocusDirection } from "./core/layout";
import type { LayoutNode, WorkspaceModel } from "./core/models";
import type { MosaicTheme } from "./core/themes";
import { defaultThemeId, themeIds, themes } from "./core/themes";
import { getWorkspaceTabLabel, serializeWorkspaceState } from "./core/workspaces";

type ThemeId = keyof typeof themes;
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
	{ action: "Previous workspace", keys: "Alt Shift Left / Up" },
	{ action: "Next workspace", keys: "Alt Shift Right / Down" },
	{ action: "Open settings", keys: "Ctrl ," },
];

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
		["--surface-tint" as string]: theme.kind === "light" ? "rgba(255, 255, 255, 0.78)" : "rgba(6, 10, 16, 0.92)",
		["--rail-tint" as string]: theme.kind === "light" ? "rgba(255, 255, 255, 0.58)" : "rgba(12, 16, 24, 0.4)",
		["--tab-active-bg" as string]: theme.kind === "light" ? "rgba(0, 0, 0, 0.03)" : "rgba(255, 255, 255, 0.02)",
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
	if (storedThemeId && storedThemeId in themes) return storedThemeId as ThemeId;
	return defaultThemeId as ThemeId;
}

function readStoredOrientation() {
	if (typeof window === "undefined") return "vertical" as const;
	return window.localStorage.getItem(STORAGE_KEYS.tabOrientation) === "horizontal" ? "horizontal" : "vertical";
}

interface WorkspaceTabItemProps {
	workspace: WorkspaceModel;
	index: number;
	isActive: boolean;
	accent: string;
	onSelect: () => void;
	onClose: () => void;
}

function WorkspaceTabItem({ workspace, isActive, accent, onSelect, onClose }: WorkspaceTabItemProps) {
	const dragControls = useDragControls();
	const isDraggingRef = useRef(false);

	return (
		<Reorder.Item
			value={workspace}
			dragListener={false}
			dragControls={dragControls}
			className={`workspace-tab ${isActive ? "active" : ""}`}
			style={{ ["--workspace-accent" as string]: accent }}
			onDragStart={() => { isDraggingRef.current = true; }}
			onDragEnd={() => { setTimeout(() => { isDraggingRef.current = false; }, 0); }}
		>
			<button
				type="button"
				className="workspace-tab-main"
				onPointerDown={(event) => dragControls.start(event)}
				onClick={() => { if (!isDraggingRef.current) onSelect(); }}
			>
				<span className="workspace-tab-copy">
					<span className="workspace-tab-label" title={workspace.path}>
						{getWorkspaceTabLabel(workspace)}
					</span>
					{workspace.git.isRepo ? <span className="workspace-tab-meta">{workspace.git.summary}</span> : null}
				</span>
			</button>
			<button
				type="button"
				className="workspace-tab-close"
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
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

	const currentTheme = themes[themeId];
	const shellStyle = useMemo(() => buildThemeVars(currentTheme), [currentTheme]);

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
			setWorkspaces((current) => {
				const index = current.findIndex((w) => w.id === workspaceId);
				if (index < 0) return current;
				const next = current.filter((w) => w.id !== workspaceId);
				setActiveIndex((currentActive) => {
					if (next.length === 0) return 0;
					if (currentActive >= next.length) return next.length - 1;
					if (currentActive > index) return currentActive - 1;
					return currentActive;
				});
				return next;
			});
		},
		[],
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

	const addWorkspace = useCallback(async () => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
		const selected = await window.mosaic.pickWorkspaceDirectory();
		if (!selected) return;

		setWorkspaces((current) => {
			const existingIndex = current.findIndex((workspace) => workspace.path === selected.path);
			if (existingIndex >= 0) {
				setActiveIndex(existingIndex);
				return current.map((workspace, index) =>
					index === existingIndex
						? {
								...workspace,
								git: selected.git,
								layout: rehydrateLayout(workspace.layout, workspace.path),
								focusedPaneId: workspace.focusedPaneId ?? findFirstPaneId(workspace.layout),
						  }
						: workspace,
				);
			}

			const layout = createPaneNode(selected.path);
			const next = [
				...current,
				{
					id: crypto.randomUUID(),
					path: selected.path,
					git: selected.git,
					layout,
					focusedPaneId: findFirstPaneId(layout),
				},
			];
			setActiveIndex(next.length - 1);
			return next;
		});
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

	const closeSettings = useCallback(() => {
		setSettingsOpen(false);
		setSettingsView("root");
	}, []);

	const activeWorkspace = workspaces[activeIndex];
	const focusedPaneId = activeWorkspace ? activeWorkspace.focusedPaneId ?? findFirstPaneId(activeWorkspace.layout) : null;
	const focusedPane = activeWorkspace && focusedPaneId ? findPaneById(activeWorkspace.layout, focusedPaneId) : null;

	const openSettings = useCallback((view: SettingsView = "root") => {
		setSettingsOpen(true);
		setSettingsView(view);
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
		const nextFocusedPaneId = findLastPaneId(nextLayout);
		updateWorkspace(activeWorkspace.id, (workspace) => ({
			...workspace,
			layout: nextLayout,
			focusedPaneId: nextFocusedPaneId,
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
		const nextLayout = closeTab(activeWorkspace.layout, focusedPaneId, focusedPane.activeTabId, activeWorkspace.path);
		updateWorkspace(activeWorkspace.id, (workspace) => ({
			...workspace,
			layout: nextLayout,
			focusedPaneId,
		}));
	}, [activeWorkspace, focusedPane, focusedPaneId, updateWorkspace]);

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
		closeFocusedTab,
		goTo,
		moveFocus,
		openSettings,
		resizeFocusedPane,
		splitFocusedPane,
		stepFocusedTab,
		tabOrientation,
	]);

	const project = activeWorkspace;
	const isVertical = tabOrientation === "vertical";
	const workspaceTabs = (
		<Reorder.Group
			as="nav"
			axis={isVertical ? "y" : "x"}
			values={workspaces}
			onReorder={reorderWorkspaces}
			className={`workspace-tabs ${isVertical ? "vertical" : ""}`}
			aria-label="Workspaces"
		>
			{workspaces.map((workspace, index) => (
				<WorkspaceTabItem
					key={workspace.id}
					workspace={workspace}
					index={index}
					isActive={index === activeIndex}
					accent={getWorkspaceAccent(currentTheme, index)}
					onSelect={() => goTo(index)}
					onClose={() => removeWorkspace(workspace.id)}
				/>
			))}
			<button type="button" className="icon-button workspace-tab-add" onClick={addWorkspace} aria-label="Open directory">
				+
			</button>
		</Reorder.Group>
	);

	const settingsPanel = (
		<div className={`settings-panel ${tabOrientation === "vertical" ? "rail" : "topbar"}`}>
			{settingsView !== "root" ? (
				<button type="button" className="settings-back" onClick={() => setSettingsView("root")}>
					Back
				</button>
			) : null}

			{settingsView === "root" ? (
				<>
					<button
						type="button"
						className="settings-item"
						onClick={() => {
							setTabOrientation((current) => (current === "horizontal" ? "vertical" : "horizontal"));
							closeSettings();
						}}
					>
						<span className="settings-item-copy">{tabOrientation === "horizontal" ? "Vertical Tabs" : "Top Tabs"}</span>
					</button>
					<button type="button" className="settings-item" onClick={() => setSettingsView("skins")}>
						<span className="settings-item-copy">Skins</span>
						<span className="settings-item-chevron">›</span>
					</button>
					<button type="button" className="settings-item" onClick={() => setSettingsView("shortcuts")}>
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
								<span className="shortcut-keys">{shortcut.keys}</span>
							</div>
						))}
					</div>
				</div>
			) : null}
		</div>
	);

	return (
		<div className="app-shell" style={shellStyle}>
			{tabOrientation === "horizontal" ? (
				<header className="topbar">
					{workspaceTabs}

					<div className="topbar-controls">
						<div className="settings-anchor">
							<button
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
								[]
							</button>
							{settingsOpen ? settingsPanel : null}
						</div>
					</div>
				</header>
			) : null}

			<div className={`workspace-shell ${tabOrientation === "vertical" ? "with-vertical-tabs" : ""}`}>
				{tabOrientation === "vertical" && workspaces.length > 0 ? (
					<aside className="workspace-rail">
						<div className="workspace-rail-body">{workspaceTabs}</div>
						<div className="workspace-rail-footer">
						<div className="settings-anchor">
							<button
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
									[]
								</button>
								{settingsOpen ? settingsPanel : null}
							</div>
						</div>
					</aside>
				) : null}
				<div className="workspace-stage">
					{workspaces.length === 0 ? (
						<div className="empty-state">
							<div className="empty-state-card">
								<div className="eyebrow">Directory Workspaces</div>
								<h1 className="empty-state-title">Select a folder to create your first workspace.</h1>
								<p className="empty-state-copy">
									Each workspace is a real directory. New panes open in that folder, names are compacted like
									<code> .../parent/current</code>, and pane tabs reopen next time.
								</p>
								<button type="button" className="new-pane-button" onClick={addWorkspace}>
									<span className="new-pane-plus">+</span> Open Directory
								</button>
							</div>
						</div>
					) : (
						workspaces.map((ws, index) => (
							<div
								key={ws.id}
								className="workspace-panel"
								style={{ display: index === activeIndex ? "block" : "none" }}
							>
								<WorkspaceView
									workspace={ws}
									accent={getWorkspaceAccent(currentTheme, index)}
									theme={currentTheme}
									focusedPaneId={ws.focusedPaneId}
									onFocusPane={(paneId) => focusPane(ws.id, paneId)}
									onUpdateLayout={(layout) =>
										updateWorkspace(ws.id, (workspace) => ({
											...workspace,
											layout,
											focusedPaneId:
												workspace.focusedPaneId && findPaneById(layout, workspace.focusedPaneId)
													? workspace.focusedPaneId
													: findFirstPaneId(layout),
										}))
									}
								/>
							</div>
						))
					)}
				</div>
			</div>

		</div>
	);
}
