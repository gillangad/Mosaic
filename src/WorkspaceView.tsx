import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { FileTreeSidebar } from "./components/FileTreeSidebar";
import { GitSidebar } from "./components/GitSidebar";
import { TerminalPane } from "./components/TerminalPane";
import {
	addBrowserTabToPane,
	addTabToPane,
	closeTab,
	COLUMN_INSERT_WIDTH_UNITS,
	enforcePaneWidthCap,
	WIDTH_UNIT_BASE,
	findFirstPaneId,
	findPaneById,
	getLayoutWidthUnits,
	movePane,
	movePaneToColumnIndex,
	moveTabToPane,
	removePane,
	resizeVerticalSplitByDelta,
	setActiveTab,
	splitNode,
	swapPanes,
	updateSplitRatio,
	updateTabMeta,
	type PaneDropPosition,
} from "./core/layout";
import type { LayoutNode, PaneModel, PaneTabModel, SplitDirection, TerminalTabModel, WorkspaceModel } from "./core/models";
import { isTerminalTab } from "./core/pane-tabs";
import type { MosaicTheme } from "./core/themes";
import { useSessionManager } from "./core/terminal-backend-context";

type FocusMode = "default" | "center" | "edge";

const FILE_TREE_MIN_WIDTH = 180;
const FILE_TREE_MAX_WIDTH = 520;

interface LayoutViewProps {
	node: LayoutNode;
	accent: string;
	theme: MosaicTheme;
	cwd: string;
	focusedPaneId?: string;
	zoomedPaneId: string | null;
	onFocusPane: (paneId: string) => void;
	onSplit: (paneId: string, direction: SplitDirection) => void;
	onMovePaneToNewColumn: (paneId: string) => void;
	canMovePaneToNewColumn: (paneId: string) => boolean;
	onClosePane: (paneId: string) => void;
	onAddTab: (paneId: string) => void;
	onAddBrowserTab: (paneId: string) => void;
	onSelectTab: (paneId: string, tabId: string) => void;
	onCloseTab: (paneId: string, tabId: string) => void;
	onMoveTab: (sourcePaneId: string, tabId: string, targetPaneId: string) => void;
	onDropTabToPane: (sourcePaneId: string, tabId: string, targetPaneId: string, position: PaneDropPosition) => void;
	onTogglePaneZoom: (paneId: string) => void;
	onBeginPaneShiftDrag: (paneId: string, clientX: number, clientY: number) => void;
	onResizeHorizontalSplit: (splitId: string, ratio: number) => void;
	onResizeVerticalSplitBranch: (splitId: string, branch: "first" | "second", deltaRatio: number) => void;
	onRegisterPaneElement: (paneId: string, element: HTMLDivElement | null) => void;
	onUpdateTabMeta: (
		paneId: string,
		tabId: string,
		patch: Partial<Pick<TerminalTabModel, "status" | "shellLabel" | "message" | "title">>,
	) => void;
	onOpenFile: (filePath: string, sourcePaneId: string) => void;
	onUpdateTab: (paneId: string, tabId: string, updater: (tab: PaneTabModel) => PaneTabModel) => void;
}

function LayoutView({
	node,
	accent,
	theme,
	cwd,
	focusedPaneId,
	zoomedPaneId,
	onFocusPane,
	onSplit,
	onMovePaneToNewColumn,
	canMovePaneToNewColumn,
	onClosePane,
	onAddTab,
	onAddBrowserTab,
	onSelectTab,
	onCloseTab,
	onMoveTab,
	onDropTabToPane,
	onTogglePaneZoom,
	onBeginPaneShiftDrag,
	onResizeHorizontalSplit,
	onResizeVerticalSplitBranch,
	onRegisterPaneElement,
	onUpdateTabMeta,
	onOpenFile,
	onUpdateTab,
}: LayoutViewProps) {
	if (node.type === "pane") {
		return (
			<div className="layout-leaf" key={node.pane.id} ref={(element) => onRegisterPaneElement(node.pane.id, element)}>
				<TerminalPane
					pane={node.pane}
					accent={accent}
					theme={theme}
					cwd={cwd}
					focused={focusedPaneId === node.pane.id}
					zoomed={zoomedPaneId === node.pane.id}
					onFocus={() => onFocusPane(node.pane.id)}
					onMoveToNewColumn={() => onMovePaneToNewColumn(node.pane.id)}
					canMoveToNewColumn={canMovePaneToNewColumn(node.pane.id)}
					onSplitVertical={() => onSplit(node.pane.id, "vertical")}
					onSplitHorizontal={() => onSplit(node.pane.id, "horizontal")}
					onClose={() => onClosePane(node.pane.id)}
					onAddTab={() => onAddTab(node.pane.id)}
					onAddBrowserTab={() => onAddBrowserTab(node.pane.id)}
					onSelectTab={(tabId) => onSelectTab(node.pane.id, tabId)}
					onCloseTab={(tabId) => onCloseTab(node.pane.id, tabId)}
					onMoveTab={onMoveTab}
					onDropTabToPane={(sourcePaneId, tabId, position) => onDropTabToPane(sourcePaneId, tabId, node.pane.id, position)}
					onToggleZoom={() => onTogglePaneZoom(node.pane.id)}
					onBeginShiftDrag={(clientX, clientY) => onBeginPaneShiftDrag(node.pane.id, clientX, clientY)}
					onUpdateTabMeta={(tabId, patch) => onUpdateTabMeta(node.pane.id, tabId, patch)}
					onOpenFile={(filePath) => onOpenFile(filePath, node.pane.id)}
					onUpdateTab={(tabId, updater) => onUpdateTab(node.pane.id, tabId, updater)}
				/>
			</div>
		);
	}

	const beginHorizontalResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
		const container = event.currentTarget.parentElement;
		if (!container) return;

		const rect = container.getBoundingClientRect();
		const handleMove = (moveEvent: MouseEvent) => {
			const nextRatio = (moveEvent.clientY - rect.top) / rect.height;
			onResizeHorizontalSplit(node.id, nextRatio);
		};
		const handleUp = () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
			document.body.classList.remove("is-resizing");
		};

		document.body.classList.add("is-resizing");
		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
	};

	const beginVerticalResize = (branch: "first" | "second") => (event: ReactMouseEvent<HTMLButtonElement>) => {
		const container = event.currentTarget.closest(".layout-split") as HTMLDivElement | null;
		if (!container) return;
		event.preventDefault();
		event.stopPropagation();

		const rect = container.getBoundingClientRect();
		let lastClientX = event.clientX;
		const handleMove = (moveEvent: MouseEvent) => {
			const deltaPx = moveEvent.clientX - lastClientX;
			lastClientX = moveEvent.clientX;
			if (Math.abs(deltaPx) < 0.01) return;
			const deltaRatio = deltaPx / Math.max(rect.width, 1);
			onResizeVerticalSplitBranch(node.id, branch, deltaRatio);
		};
		const handleUp = () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
			document.body.classList.remove("is-resizing");
		};

		document.body.classList.add("is-resizing");
		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
	};

	return (
		<div className={`layout-split layout-${node.direction}`}>
			<div
				className={`layout-branch ${node.direction === "vertical" ? "vertical-first" : "horizontal-first"}`}
				style={{ ["--branch-ratio" as string]: String(node.ratio), ["--branch-size" as string]: `${node.ratio * 100}%` }}
			>
				<LayoutView
					node={node.first}
					accent={accent}
					theme={theme}
					cwd={cwd}
					focusedPaneId={focusedPaneId}
					zoomedPaneId={zoomedPaneId}
					onFocusPane={onFocusPane}
					onSplit={onSplit}
					onMovePaneToNewColumn={onMovePaneToNewColumn}
					canMovePaneToNewColumn={canMovePaneToNewColumn}
					onClosePane={onClosePane}
					onAddTab={onAddTab}
					onAddBrowserTab={onAddBrowserTab}
					onSelectTab={onSelectTab}
					onCloseTab={onCloseTab}
					onMoveTab={onMoveTab}
					onDropTabToPane={onDropTabToPane}
					onTogglePaneZoom={onTogglePaneZoom}
					onBeginPaneShiftDrag={onBeginPaneShiftDrag}
					onResizeHorizontalSplit={onResizeHorizontalSplit}
					onResizeVerticalSplitBranch={onResizeVerticalSplitBranch}
					onRegisterPaneElement={onRegisterPaneElement}
					onUpdateTabMeta={onUpdateTabMeta}
					onOpenFile={onOpenFile}
					onUpdateTab={onUpdateTab}
				/>
			</div>
			{node.direction === "vertical" ? (
				<div className="layout-resizer layout-resizer-vertical" role="separator" aria-label="Resize columns">
					<button
						type="button"
						className="layout-edge-handle first"
						onMouseDown={beginVerticalResize("first")}
						aria-label="Resize right edge of left pane"
					/>
					<button
						type="button"
						className="layout-edge-handle second"
						onMouseDown={beginVerticalResize("second")}
						aria-label="Resize left edge of right pane"
					/>
				</div>
			) : (
				<button
					type="button"
					className="layout-resizer layout-resizer-horizontal"
					onMouseDown={beginHorizontalResize}
					aria-label="Resize panes vertically"
				/>
			)}
			<div
				className={`layout-branch ${node.direction === "vertical" ? "vertical-second" : "horizontal-second"}`}
				style={{
					["--branch-ratio" as string]: String(node.ratio),
					["--branch-size" as string]: `${(1 - node.ratio) * 100}%`,
				}}
			>
				<LayoutView
					node={node.second}
					accent={accent}
					theme={theme}
					cwd={cwd}
					focusedPaneId={focusedPaneId}
					zoomedPaneId={zoomedPaneId}
					onFocusPane={onFocusPane}
					onSplit={onSplit}
					onMovePaneToNewColumn={onMovePaneToNewColumn}
					canMovePaneToNewColumn={canMovePaneToNewColumn}
					onClosePane={onClosePane}
					onAddTab={onAddTab}
					onAddBrowserTab={onAddBrowserTab}
					onSelectTab={onSelectTab}
					onCloseTab={onCloseTab}
					onMoveTab={onMoveTab}
					onDropTabToPane={onDropTabToPane}
					onTogglePaneZoom={onTogglePaneZoom}
					onBeginPaneShiftDrag={onBeginPaneShiftDrag}
					onResizeHorizontalSplit={onResizeHorizontalSplit}
					onResizeVerticalSplitBranch={onResizeVerticalSplitBranch}
					onRegisterPaneElement={onRegisterPaneElement}
					onUpdateTabMeta={onUpdateTabMeta}
					onOpenFile={onOpenFile}
					onUpdateTab={onUpdateTab}
				/>
			</div>
		</div>
	);
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function revealFocusedPane(container: HTMLDivElement, paneElement: HTMLDivElement, focusMode: FocusMode) {
	if (focusMode === "default") {
		paneElement.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
		return;
	}

	const maxScrollLeft = Math.max(container.scrollWidth - container.clientWidth, 0);
	const paneLeft = paneElement.offsetLeft;
	const paneWidth = paneElement.offsetWidth;
	const paneRight = paneLeft + paneWidth;
	const viewportLeft = container.scrollLeft;
	const viewportRight = viewportLeft + container.clientWidth;

	if (focusMode === "center") {
		const centeredLeft = paneLeft - (container.clientWidth - paneWidth) / 2;
		container.scrollLeft = clamp(centeredLeft, 0, maxScrollLeft);
		return;
	}

	if (paneLeft < viewportLeft) {
		container.scrollLeft = clamp(paneLeft, 0, maxScrollLeft);
		return;
	}
	if (paneRight > viewportRight) {
		container.scrollLeft = clamp(paneRight - container.clientWidth, 0, maxScrollLeft);
		return;
	}

	const leftSnap = paneLeft;
	const rightSnap = paneRight - container.clientWidth;
	const nextScrollLeft = Math.abs(container.scrollLeft - leftSnap) <= Math.abs(container.scrollLeft - rightSnap) ? leftSnap : rightSnap;
	container.scrollLeft = clamp(nextScrollLeft, 0, maxScrollLeft);
}

interface OverviewPaneRect {
	pane: PaneModel;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface PaneDragState {
	sourcePaneId: string;
	startClientX: number;
	startClientY: number;
	clientX: number;
	clientY: number;
	moved: boolean;
}

interface PaneDropTarget {
	targetPaneId: string;
	position: PaneDropPosition;
}

interface OverviewColumnRect {
	paneIds: string[];
	x: number;
	width: number;
}

function collectOverviewPaneRects(node: LayoutNode, x: number, y: number, width: number, height: number, result: OverviewPaneRect[]) {
	if (node.type === "pane") {
		result.push({
			pane: node.pane,
			x,
			y,
			width,
			height,
		});
		return;
	}

	if (node.direction === "vertical") {
		const firstWidth = width * node.ratio;
		collectOverviewPaneRects(node.first, x, y, firstWidth, height, result);
		collectOverviewPaneRects(node.second, x + firstWidth, y, width - firstWidth, height, result);
		return;
	}

	const firstHeight = height * node.ratio;
	collectOverviewPaneRects(node.first, x, y, width, firstHeight, result);
	collectOverviewPaneRects(node.second, x, y + firstHeight, width, height - firstHeight, result);
}

function collectOverviewColumnPaneIds(node: LayoutNode): string[] {
	if (node.type === "pane") return [node.pane.id];
	return [...collectOverviewColumnPaneIds(node.first), ...collectOverviewColumnPaneIds(node.second)];
}

function collectPaneIds(node: LayoutNode, result: string[] = []) {
	if (node.type === "pane") {
		result.push(node.pane.id);
		return result;
	}
	collectPaneIds(node.first, result);
	collectPaneIds(node.second, result);
	return result;
}

function collectOverviewColumnRects(node: LayoutNode, x: number, width: number, result: OverviewColumnRect[]) {
	if (node.type === "split" && node.direction === "vertical") {
		const firstWidth = width * node.ratio;
		collectOverviewColumnRects(node.first, x, firstWidth, result);
		collectOverviewColumnRects(node.second, x + firstWidth, width - firstWidth, result);
		return;
	}

	result.push({
		paneIds: collectOverviewColumnPaneIds(node),
		x,
		width,
	});
}

function resolveDropPosition(rect: OverviewPaneRect, worldX: number, worldY: number): PaneDropPosition {
	const relativeX = (worldX - rect.x) / rect.width;
	const relativeY = (worldY - rect.y) / rect.height;

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

function hitTestPaneRects(
	paneRects: OverviewPaneRect[],
	sourcePaneId: string,
	worldX: number,
	worldY: number,
): PaneDropTarget | null {
	const hit = paneRects.find((rect) => {
		if (rect.pane.id === sourcePaneId) return false;
		return worldX >= rect.x && worldX <= rect.x + rect.width && worldY >= rect.y && worldY <= rect.y + rect.height;
	});
	if (!hit) return null;
	return { targetPaneId: hit.pane.id, position: resolveDropPosition(hit, worldX, worldY) };
}

const OVERVIEW_COLUMN_INSERT_THRESHOLD_PX = 20;
const OVERVIEW_COLUMN_INSERT_HYSTERESIS_PX = 2;
const OVERVIEW_COLUMN_INSERT_WIDTH_WORLD = (COLUMN_INSERT_WIDTH_UNITS / WIDTH_UNIT_BASE) * 1100;
const OVERVIEW_EDGE_ALLOWANCE_WORLD = OVERVIEW_COLUMN_INSERT_WIDTH_WORLD * 2;

interface UsePaneDragOptions {
	paneRects: OverviewPaneRect[];
	toWorld: (clientX: number, clientY: number) => { x: number; y: number } | null;
	onMovePane: (sourcePaneId: string, targetPaneId: string, position: PaneDropPosition) => void;
	onInsertColumn?: (sourcePaneId: string, columnIndex: number) => void;
	resolveColumnInsert?: (clientX: number, clientY: number, currentIndex: number | null) => number | null;
	onClickPane?: (paneId: string) => void;
	moveThreshold?: number;
}

function usePaneDrag({ paneRects, toWorld, onMovePane, onInsertColumn, resolveColumnInsert, onClickPane, moveThreshold = 6 }: UsePaneDragOptions) {
	const [dragState, setDragState] = useState<PaneDragState | null>(null);
	const [hoverDrop, setHoverDrop] = useState<PaneDropTarget | null>(null);
	const [columnInsertIndex, setColumnInsertIndex] = useState<number | null>(null);
	const dragStateRef = useRef<PaneDragState | null>(null);
	const hoverDropRef = useRef<PaneDropTarget | null>(null);
	const columnInsertIndexRef = useRef<number | null>(null);

	const startDrag = useCallback((paneId: string, clientX: number, clientY: number) => {
		const nextDragState = { sourcePaneId: paneId, startClientX: clientX, startClientY: clientY, clientX, clientY, moved: false };
		dragStateRef.current = nextDragState;
		hoverDropRef.current = null;
		columnInsertIndexRef.current = null;
		setDragState(nextDragState);
		setHoverDrop(null);
		setColumnInsertIndex(null);
	}, []);

	useEffect(() => {
		if (!dragState) return;

		const handleMove = (event: MouseEvent) => {
			const currentDragState = dragStateRef.current;
			if (!currentDragState) return;
			const deltaX = event.clientX - currentDragState.startClientX;
			const deltaY = event.clientY - currentDragState.startClientY;
			const moved = currentDragState.moved || Math.hypot(deltaX, deltaY) > moveThreshold;
			const nextDragState = { ...currentDragState, clientX: event.clientX, clientY: event.clientY, moved };
			dragStateRef.current = nextDragState;
			setDragState(nextDragState);

			const nextColumnInsertIndex = moved && onInsertColumn && paneRects.length > 1
				? resolveColumnInsert?.(event.clientX, event.clientY, columnInsertIndexRef.current) ?? null
				: null;
			columnInsertIndexRef.current = nextColumnInsertIndex;
			setColumnInsertIndex(nextColumnInsertIndex);

			const worldPoint = toWorld(event.clientX, event.clientY);
			if (!worldPoint || nextColumnInsertIndex !== null) {
				hoverDropRef.current = null;
				setHoverDrop(null);
				return;
			}

			const nextHoverDrop = hitTestPaneRects(paneRects, currentDragState.sourcePaneId, worldPoint.x, worldPoint.y);
			hoverDropRef.current = nextHoverDrop;
			setHoverDrop(nextHoverDrop);
		};

		const handleUp = () => {
			const currentDragState = dragStateRef.current;
			const currentColumnInsertIndex = columnInsertIndexRef.current;
			const currentHoverDrop = hoverDropRef.current;
			if (!currentDragState) return;
			if (currentDragState.moved && currentColumnInsertIndex !== null && onInsertColumn) {
				onInsertColumn(currentDragState.sourcePaneId, currentColumnInsertIndex);
			} else if (currentDragState.moved && currentHoverDrop) {
				onMovePane(currentDragState.sourcePaneId, currentHoverDrop.targetPaneId, currentHoverDrop.position);
			} else if (!currentDragState.moved && onClickPane) {
				onClickPane(currentDragState.sourcePaneId);
			}
			dragStateRef.current = null;
			hoverDropRef.current = null;
			columnInsertIndexRef.current = null;
			setDragState(null);
			setHoverDrop(null);
			setColumnInsertIndex(null);
		};

		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
		return () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
		};
	}, [dragState, moveThreshold, onClickPane, onInsertColumn, onMovePane, paneRects, resolveColumnInsert, toWorld]);

	return { dragState, hoverDrop, columnInsertIndex, startDrag };
}

function stripAnsi(value: string) {
	return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, "");
}

function buildOverviewPreview(snapshot: string) {
	const cleaned = stripAnsi(snapshot)
		.replace(/\r/g, "")
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.trim().length > 0);
	if (cleaned.length === 0) return "No output yet";
	return cleaned.slice(-7).join("\n");
}

interface OverviewCanvasProps {
	layout: LayoutNode;
	focusedPaneId?: string;
	initialDrag?: { paneId: string; clientX: number; clientY: number } | null;
	onConsumeInitialDrag: () => void;
	onFocusPane: (paneId: string) => void;
	onMovePane: (sourcePaneId: string, targetPaneId: string, position: PaneDropPosition) => void;
	onInsertColumn: (sourcePaneId: string, columnIndex: number) => void;
	onClosePane: (paneId: string) => void;
	onExitOverview: () => void;
}

function OverviewCanvas({ layout, focusedPaneId, initialDrag, onConsumeInitialDrag, onFocusPane, onMovePane, onInsertColumn, onClosePane, onExitOverview }: OverviewCanvasProps) {
	const sessionManager = useSessionManager();
	const stageRef = useRef<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState({ width: 1, height: 1 });
	const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
	const [panState, setPanState] = useState<null | { startClientX: number; startClientY: number; originX: number; originY: number }>(null);
	const overviewPanVelocityRef = useRef({ x: 0, y: 0 });
	const overviewPanLastMoveRef = useRef<{ x: number; y: number; time: number } | null>(null);
	const overviewPanMomentumRef = useRef<number | null>(null);

	const contentWidth = (Math.max(getLayoutWidthUnits(layout), WIDTH_UNIT_BASE) / WIDTH_UNIT_BASE) * 1100;
	const contentHeight = 760;

	const paneRects = useMemo(() => {
		const result: OverviewPaneRect[] = [];
		collectOverviewPaneRects(layout, 0, 0, contentWidth, contentHeight, result);
		return result;
	}, [contentHeight, contentWidth, layout]);

	const columnRects = useMemo(() => {
		const result: OverviewColumnRect[] = [];
		collectOverviewColumnRects(layout, 0, contentWidth, result);
		return result;
	}, [contentWidth, layout]);

	const paneColumnIndexByPaneId = useMemo(() => {
		const result = new Map<string, number>();
		columnRects.forEach((columnRect, columnIndex) => {
			columnRect.paneIds.forEach((paneId) => result.set(paneId, columnIndex));
		});
		return result;
	}, [columnRects]);

	useEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;
		const observer = new ResizeObserver(() => {
			const rect = stage.getBoundingClientRect();
			setViewport({ width: rect.width, height: rect.height });
		});
		observer.observe(stage);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const padding = 56;
		const fitWidth = contentWidth + OVERVIEW_EDGE_ALLOWANCE_WORLD;
		const fitScale = Math.min((viewport.width - padding) / fitWidth, (viewport.height - padding) / contentHeight);
		const nextScale = clamp(fitScale, 0.15, 1.15);
		const nextX = (viewport.width - contentWidth * nextScale) / 2;
		const nextY = (viewport.height - contentHeight * nextScale) / 2;
		setCamera({ x: nextX, y: nextY, scale: nextScale });
	}, [contentHeight, contentWidth, viewport.height, viewport.width]);

	const toWorld = useCallback(
		(clientX: number, clientY: number) => {
			const stage = stageRef.current;
			if (!stage) return null;
			const rect = stage.getBoundingClientRect();
			const localX = clientX - rect.left;
			const localY = clientY - rect.top;
			return {
				x: (localX - camera.x) / camera.scale,
				y: (localY - camera.y) / camera.scale,
			};
		},
		[camera.x, camera.y, camera.scale],
	);

	const handleOverviewClick = useCallback(
		(paneId: string) => {
			onFocusPane(paneId);
			onExitOverview();
		},
		[onExitOverview, onFocusPane],
	);

	const resolveOverviewColumnInsert = useCallback((clientX: number, _clientY: number, currentIndex: number | null) => {
		if (columnRects.length === 0) return null;

		const worldLeft = camera.x;
		const worldRight = camera.x + contentWidth * camera.scale;
		const interiorBoundaries = columnRects.slice(1).map((columnRect, index) => ({
			columnIndex: index + 1,
			x: camera.x + columnRect.x * camera.scale,
		}));

		if (currentIndex === 0) {
			const leftRelease = worldLeft - (OVERVIEW_COLUMN_INSERT_THRESHOLD_PX - OVERVIEW_COLUMN_INSERT_HYSTERESIS_PX);
			if (clientX <= leftRelease) return 0;
		}
		if (currentIndex === columnRects.length) {
			const rightRelease = worldRight + (OVERVIEW_COLUMN_INSERT_THRESHOLD_PX - OVERVIEW_COLUMN_INSERT_HYSTERESIS_PX);
			if (clientX >= rightRelease) return columnRects.length;
		}
		if (currentIndex !== null && currentIndex > 0 && currentIndex < columnRects.length) {
			const currentBoundary = interiorBoundaries.find((boundary) => boundary.columnIndex === currentIndex);
			if (currentBoundary && Math.abs(clientX - currentBoundary.x) <= OVERVIEW_COLUMN_INSERT_THRESHOLD_PX + OVERVIEW_COLUMN_INSERT_HYSTERESIS_PX) {
				return currentIndex;
			}
		}

		if (clientX <= worldLeft - OVERVIEW_COLUMN_INSERT_THRESHOLD_PX) return 0;
		if (clientX >= worldRight + OVERVIEW_COLUMN_INSERT_THRESHOLD_PX) return columnRects.length;

		let nearestBoundary: { columnIndex: number; distance: number } | null = null;
		for (const boundary of interiorBoundaries) {
			const distance = Math.abs(clientX - boundary.x);
			if (!nearestBoundary || distance < nearestBoundary.distance) {
				nearestBoundary = { columnIndex: boundary.columnIndex, distance };
			}
		}

		if (nearestBoundary && nearestBoundary.distance <= OVERVIEW_COLUMN_INSERT_THRESHOLD_PX) {
			return nearestBoundary.columnIndex;
		}

		return null;
	}, [camera.x, camera.scale, columnRects, contentWidth]);

	const { dragState, hoverDrop, columnInsertIndex, startDrag } = usePaneDrag({
		paneRects,
		toWorld,
		onMovePane,
		onInsertColumn,
		resolveColumnInsert: resolveOverviewColumnInsert,
		onClickPane: handleOverviewClick,
	});

	useEffect(() => {
		if (!initialDrag) return;
		const rafId = window.requestAnimationFrame(() => {
			startDrag(initialDrag.paneId, initialDrag.clientX, initialDrag.clientY);
			onConsumeInitialDrag();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, [initialDrag, onConsumeInitialDrag, startDrag]);

	useEffect(() => {
		if (!panState) return;

		const handleMove = (event: MouseEvent) => {
			setCamera((current) => ({
				...current,
				x: panState.originX + (event.clientX - panState.startClientX),
				y: panState.originY + (event.clientY - panState.startClientY),
			}));

			const now = performance.now();
			const last = overviewPanLastMoveRef.current;
			if (last) {
				const deltaTime = Math.max(now - last.time, 1);
				const instantVelocityX = (event.clientX - last.x) / deltaTime;
				const instantVelocityY = (event.clientY - last.y) / deltaTime;
				overviewPanVelocityRef.current = {
					x: overviewPanVelocityRef.current.x * 0.62 + instantVelocityX * 0.38,
					y: overviewPanVelocityRef.current.y * 0.62 + instantVelocityY * 0.38,
				};
			}
			overviewPanLastMoveRef.current = { x: event.clientX, y: event.clientY, time: now };
		};

		const handleUp = () => {
			setPanState(null);
			overviewPanLastMoveRef.current = null;
			const initialVelocity = overviewPanVelocityRef.current;
			if (Math.hypot(initialVelocity.x, initialVelocity.y) < 0.03) {
				overviewPanVelocityRef.current = { x: 0, y: 0 };
				return;
			}
			if (overviewPanMomentumRef.current !== null) {
				window.cancelAnimationFrame(overviewPanMomentumRef.current);
				overviewPanMomentumRef.current = null;
			}

			const step = () => {
				setCamera((current) => {
					const velocity = overviewPanVelocityRef.current;
					const nextCamera = {
						...current,
						x: current.x + velocity.x * 16,
						y: current.y + velocity.y * 16,
					};
					overviewPanVelocityRef.current = {
						x: velocity.x * 0.9,
						y: velocity.y * 0.9,
					};
					return nextCamera;
				});

				if (Math.hypot(overviewPanVelocityRef.current.x, overviewPanVelocityRef.current.y) < 0.01) {
					overviewPanVelocityRef.current = { x: 0, y: 0 };
					overviewPanMomentumRef.current = null;
					return;
				}

				overviewPanMomentumRef.current = window.requestAnimationFrame(step);
			};

			overviewPanMomentumRef.current = window.requestAnimationFrame(step);
		};

		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
		return () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
		};
	}, [panState]);

	useEffect(() => {
		return () => {
			if (overviewPanMomentumRef.current !== null) {
				window.cancelAnimationFrame(overviewPanMomentumRef.current);
				overviewPanMomentumRef.current = null;
			}
		};
	}, []);

	const showOverviewColumnTargets = Boolean(dragState?.moved && columnRects.length > 0);
	const renderedPaneRects = columnInsertIndex === null
		? paneRects
		: paneRects.map((paneRect) => {
			const columnIndex = paneColumnIndexByPaneId.get(paneRect.pane.id) ?? 0;
			return columnIndex < columnInsertIndex ? paneRect : { ...paneRect, x: paneRect.x + OVERVIEW_COLUMN_INSERT_WIDTH_WORLD };
		});
	const draggedPane = dragState ? paneRects.find((rect) => rect.pane.id === dragState.sourcePaneId)?.pane ?? null : null;
	const draggedActiveTab = draggedPane ? draggedPane.tabs.find((tab) => tab.id === draggedPane.activeTabId) ?? draggedPane.tabs[0] : null;
	const draggedPreview = draggedActiveTab ? buildOverviewPreview(sessionManager.getSnapshot(draggedActiveTab.id) ?? "") : "No output yet";
	const columnInsertPreview =
		showOverviewColumnTargets &&
		columnInsertIndex !== null &&
		draggedPane &&
		columnInsertIndex > 0 &&
		columnInsertIndex < columnRects.length
			? (() => {
				const ghostWidth = OVERVIEW_COLUMN_INSERT_WIDTH_WORLD * camera.scale;
				const ghostLeft = camera.x + columnRects[columnInsertIndex].x * camera.scale;
				return {
					label: "Insert column",
					title: draggedActiveTab?.title ?? "terminal",
					tabCount: draggedPane.tabs.length,
					preview: draggedPreview,
					lineLeft: ghostLeft,
					ghostLeft,
					ghostWidth,
					top: camera.y,
					height: contentHeight * camera.scale,
				};
			})()
			: null;
	const overviewCloseScale = clamp(1 / camera.scale, 1, 2.4);

	return (
		<div
			ref={stageRef}
			className="overview-stage"
			onMouseDown={(event) => {
				if (event.button !== 0) return;
				const target = event.target as HTMLElement;
				if (target.closest(".overview-pane-card")) return;
				if (overviewPanMomentumRef.current !== null) {
					window.cancelAnimationFrame(overviewPanMomentumRef.current);
					overviewPanMomentumRef.current = null;
				}
				overviewPanVelocityRef.current = { x: 0, y: 0 };
				overviewPanLastMoveRef.current = { x: event.clientX, y: event.clientY, time: performance.now() };
				setPanState({
					startClientX: event.clientX,
					startClientY: event.clientY,
					originX: camera.x,
					originY: camera.y,
				});
			}}
			onWheel={(event) => {
				event.preventDefault();
				const worldPoint = toWorld(event.clientX, event.clientY);
				if (!worldPoint) return;
				const zoomFactor = Math.exp(-event.deltaY * 0.0012);
				setCamera((current) => {
					const nextScale = clamp(current.scale * zoomFactor, 0.12, 1.8);
					const stage = stageRef.current;
					if (!stage) return current;
					const rect = stage.getBoundingClientRect();
					const localX = event.clientX - rect.left;
					const localY = event.clientY - rect.top;
					return {
						scale: nextScale,
						x: localX - worldPoint.x * nextScale,
						y: localY - worldPoint.y * nextScale,
					};
				});
			}}
		>
			<div className="overview-hint">Drag panes. Drop on pane edges to split, center to swap, drag between columns to insert, or drag past the layout edge to make a new outer column. Scroll to zoom.</div>
			<div
				className="overview-world"
				style={{
					width: `${contentWidth}px`,
					height: `${contentHeight}px`,
					transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
				}}
			>
				{renderedPaneRects.map((paneRect) => {
					const isSource = dragState?.sourcePaneId === paneRect.pane.id;
					const dropPosition = hoverDrop?.targetPaneId === paneRect.pane.id ? hoverDrop.position : null;
					const activeTab = paneRect.pane.tabs.find((tab) => tab.id === paneRect.pane.activeTabId) ?? paneRect.pane.tabs[0];
					const snapshot = activeTab ? sessionManager.getSnapshot(activeTab.id) : "";
					const preview = buildOverviewPreview(snapshot);
					return (
						<div
							key={paneRect.pane.id}
							className={`overview-pane-card ${focusedPaneId === paneRect.pane.id ? "focused" : ""} ${isSource ? "drag-source" : ""}`}
							style={{
								left: `${paneRect.x}px`,
								top: `${paneRect.y}px`,
								width: `${paneRect.width}px`,
								height: `${paneRect.height}px`,
							}}
							onMouseDown={(event) => {
								if (event.button !== 0) return;
								event.stopPropagation();
								startDrag(paneRect.pane.id, event.clientX, event.clientY);
							}}
						>
							<div className="overview-pane-title-row">
								<div className="overview-pane-header">{activeTab?.title ?? "terminal"}</div>
								<button
									type="button"
									className="overview-pane-close"
									style={{ ["--overview-close-scale" as string]: String(overviewCloseScale) }}
									onMouseDown={(event) => {
										event.stopPropagation();
									}}
									onClick={(event) => {
										event.stopPropagation();
										onClosePane(paneRect.pane.id);
									}}
									aria-label={`Close pane ${activeTab?.title ?? "terminal"}`}
								>
									×
								</button>
							</div>
							<div className="overview-pane-meta">{paneRect.pane.tabs.length} tab{paneRect.pane.tabs.length === 1 ? "" : "s"}</div>
							<pre className="overview-pane-preview">{preview}</pre>
							{dropPosition ? <div className={`overview-drop-overlay ${dropPosition}`} /> : null}
						</div>
					);
				})}
			</div>
			{columnInsertPreview ? (
				<>
					<div
						className="overview-detach-edge-line"
						style={{
							left: `${columnInsertPreview.lineLeft}px`,
							top: `${columnInsertPreview.top}px`,
							height: `${columnInsertPreview.height}px`,
						}}
					/>
					<div
						className="overview-detach-ghost"
						style={{
							left: `${columnInsertPreview.ghostLeft}px`,
							top: `${columnInsertPreview.top}px`,
							width: `${columnInsertPreview.ghostWidth}px`,
							height: `${columnInsertPreview.height}px`,
						}}
					>
						<div className="overview-detach-ghost-pill">{columnInsertPreview.label}</div>
						<div className="overview-detach-ghost-title">{columnInsertPreview.title}</div>
						<div className="overview-detach-ghost-meta">{columnInsertPreview.tabCount} tab{columnInsertPreview.tabCount === 1 ? "" : "s"}</div>
						<pre className="overview-detach-ghost-preview">{columnInsertPreview.preview}</pre>
					</div>
				</>
			) : null}
		</div>
	);
}

interface WorkspaceViewProps {
	workspace: WorkspaceModel;
	accent: string;
	theme: MosaicTheme;
	focusMode: FocusMode;
	fileTreeOpen: boolean;
	fileTreeWidth: number;
	onFileTreeWidthChange: (width: number) => void;
	gitPaneOpen: boolean;
	gitPaneWidth: number;
	onGitPaneWidthChange: (width: number) => void;
	onRefreshWorkspaceGit: () => Promise<void> | void;
	overviewOpen: boolean;
	focusedPaneId?: string;
	onExitOverview: () => void;
	onOpenOverview: () => void;
	onAddPane: () => void;
	onAddBrowserPane: () => void;
	onOpenFile: (filePath: string) => void;
	onUpdateTab: (paneId: string, tabId: string, updater: (tab: PaneTabModel) => PaneTabModel) => void;
	onFocusPane: (paneId: string) => void;
	onSwapPanes: (sourcePaneId: string, targetPaneId: string) => void;
	onSplitPane: (paneId: string, direction: SplitDirection) => void;
	onUpdateLayout: (layout: LayoutNode) => void;
}

export function WorkspaceView({
	workspace,
	accent,
	theme,
	focusMode,
	fileTreeOpen,
	fileTreeWidth,
	onFileTreeWidthChange,
	gitPaneOpen,
	gitPaneWidth,
	onGitPaneWidthChange,
	onRefreshWorkspaceGit,
	overviewOpen,
	focusedPaneId,
	onExitOverview,
	onOpenOverview,
	onAddPane,
	onAddBrowserPane,
	onOpenFile,
	onUpdateTab,
	onFocusPane,
	onSwapPanes,
	onSplitPane,
	onUpdateLayout,
}: WorkspaceViewProps) {
	const sessionManager = useSessionManager();
	const layoutRootRef = useRef<HTMLDivElement | null>(null);
	const paneElementsRef = useRef(new Map<string, HTMLDivElement>());
	const [zoomedPaneId, setZoomedPaneId] = useState<string | null>(null);
	const [overviewSeedDrag, setOverviewSeedDrag] = useState<{ paneId: string; clientX: number; clientY: number } | null>(null);
	const [middlePanning, setMiddlePanning] = useState(false);
	const [newPaneMenuOpen, setNewPaneMenuOpen] = useState(false);
	const newPaneMenuRef = useRef<HTMLDivElement | null>(null);

	const middlePanStateRef = useRef<null | {
		startClientX: number;
		startClientY: number;
		originScrollLeft: number;
		originScrollTop: number;
	}>(null);
	const middlePanVelocityRef = useRef({ x: 0, y: 0 });
	const middlePanLastMoveRef = useRef<{ x: number; y: number; time: number } | null>(null);
	const middlePanMomentumRafRef = useRef<number | null>(null);
	const layoutRef = useRef(workspace.layout);

	const registerPaneElement = useCallback((paneId: string, element: HTMLDivElement | null) => {
		if (!element) {
			paneElementsRef.current.delete(paneId);
			return;
		}
		paneElementsRef.current.set(paneId, element);
	}, []);

	useEffect(() => {
		layoutRef.current = workspace.layout;
	}, [workspace.layout]);

	const applyLayout = useCallback(
		(transform: (layout: LayoutNode) => LayoutNode) => {
			const nextLayout = enforcePaneWidthCap(transform(layoutRef.current));
			layoutRef.current = nextLayout;
			onUpdateLayout(nextLayout);
			return nextLayout;
		},
		[onUpdateLayout],
	);

	useEffect(() => {
		setZoomedPaneId(null);
		setNewPaneMenuOpen(false);
	}, [workspace.id]);

	useEffect(() => {
		if (!newPaneMenuOpen) return;
		const handlePointerDown = (event: MouseEvent) => {
			const menu = newPaneMenuRef.current;
			if (!menu) return;
			if (menu.contains(event.target as Node)) return;
			setNewPaneMenuOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setNewPaneMenuOpen(false);
		};
		window.addEventListener("mousedown", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("mousedown", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [newPaneMenuOpen]);

	useEffect(() => {
		if (!zoomedPaneId) return;
		if (findPaneById(workspace.layout, zoomedPaneId)) return;
		setZoomedPaneId(null);
	}, [workspace.layout, zoomedPaneId]);

	useEffect(() => {
		const handleKeydown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey && event.shiftKey && !event.altKey && event.code === "KeyM")) return;
			const target = event.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				target?.isContentEditable;
			if (isEditableTarget) return;
			event.preventDefault();
			setZoomedPaneId((current) => {
				if (current) return null;
				return focusedPaneId ?? findFirstPaneId(workspace.layout);
			});
		};

		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	}, [focusedPaneId, workspace.layout]);

	useEffect(() => {
		if (!focusedPaneId || overviewOpen) return;
		const container = layoutRootRef.current;
		const paneElement = paneElementsRef.current.get(focusedPaneId);
		if (!container || !paneElement) return;

		const raf = window.requestAnimationFrame(() => {
			revealFocusedPane(container, paneElement, focusMode);
		});
		return () => window.cancelAnimationFrame(raf);
	}, [focusMode, focusedPaneId, overviewOpen, workspace.id]);

	useEffect(() => {
		if (!middlePanning) return;

		const handleMouseMove = (event: MouseEvent) => {
			const state = middlePanStateRef.current;
			const container = layoutRootRef.current;
			if (!state || !container) return;

			const deltaX = event.clientX - state.startClientX;
			const deltaY = event.clientY - state.startClientY;
			container.scrollLeft = state.originScrollLeft - deltaX;
			container.scrollTop = state.originScrollTop - deltaY;

			const now = performance.now();
			const last = middlePanLastMoveRef.current;
			if (last) {
				const deltaTime = Math.max(now - last.time, 1);
				const instantVelocityX = (event.clientX - last.x) / deltaTime;
				const instantVelocityY = (event.clientY - last.y) / deltaTime;
				middlePanVelocityRef.current = {
					x: middlePanVelocityRef.current.x * 0.62 + instantVelocityX * 0.38,
					y: middlePanVelocityRef.current.y * 0.62 + instantVelocityY * 0.38,
				};
			}
			middlePanLastMoveRef.current = { x: event.clientX, y: event.clientY, time: now };
		};

		const stopMiddlePan = () => {
			middlePanStateRef.current = null;
			middlePanLastMoveRef.current = null;
			setMiddlePanning(false);

			const launchVelocity = middlePanVelocityRef.current;
			const speed = Math.hypot(launchVelocity.x, launchVelocity.y);
			if (speed < 0.03) {
				middlePanVelocityRef.current = { x: 0, y: 0 };
				return;
			}

			if (middlePanMomentumRafRef.current !== null) {
				window.cancelAnimationFrame(middlePanMomentumRafRef.current);
				middlePanMomentumRafRef.current = null;
			}

			const step = () => {
				const container = layoutRootRef.current;
				if (!container) {
					middlePanMomentumRafRef.current = null;
					return;
				}

				const velocity = middlePanVelocityRef.current;
				container.scrollLeft -= velocity.x * 16;
				container.scrollTop -= velocity.y * 16;

				middlePanVelocityRef.current = {
					x: velocity.x * 0.9,
					y: velocity.y * 0.9,
				};

				if (Math.hypot(middlePanVelocityRef.current.x, middlePanVelocityRef.current.y) < 0.01) {
					middlePanVelocityRef.current = { x: 0, y: 0 };
					middlePanMomentumRafRef.current = null;
					return;
				}

				middlePanMomentumRafRef.current = window.requestAnimationFrame(step);
			};

			middlePanMomentumRafRef.current = window.requestAnimationFrame(step);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", stopMiddlePan);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", stopMiddlePan);
		};
	}, [middlePanning]);

	useEffect(() => {
		return () => {
			if (middlePanMomentumRafRef.current !== null) {
				window.cancelAnimationFrame(middlePanMomentumRafRef.current);
				middlePanMomentumRafRef.current = null;
			}
		};
	}, []);

	const handleClosePane = useCallback(
		(paneId: string) => {
			const pane = findPaneById(layoutRef.current, paneId);
			if (pane) {
				const dirtyEditors = pane.tabs.filter((tab) => (tab.kind === "editor" || tab.kind === "markdown") && tab.dirty);
				if (dirtyEditors.length > 0) {
					const shouldClose = window.confirm(`Discard unsaved changes in ${dirtyEditors.length} tab${dirtyEditors.length === 1 ? "" : "s"}?`);
					if (!shouldClose) return;
				}
				for (const tab of pane.tabs) {
					if (isTerminalTab(tab)) sessionManager.closeSession(tab.id);
				}
			}
			applyLayout((layout) => removePane(layout, paneId) ?? layout);
			setZoomedPaneId((current) => (current === paneId ? null : current));
		},
		[applyLayout, sessionManager],
	);

	const overviewWorldWidth = (Math.max(getLayoutWidthUnits(workspace.layout), WIDTH_UNIT_BASE) / WIDTH_UNIT_BASE) * 1100;

	const resolveNormalizedColumnIndex = useCallback(
		(paneId: string, desiredColumnIndex: number) => {
			const columns: OverviewColumnRect[] = [];
			collectOverviewColumnRects(workspace.layout, 0, overviewWorldWidth, columns);
			const sourceColumnIndex = columns.findIndex((columnRect) => columnRect.paneIds.includes(paneId));
			const sourceColumnPaneCount = sourceColumnIndex >= 0 ? columns[sourceColumnIndex]?.paneIds.length ?? 0 : 0;
			return sourceColumnPaneCount === 1 && sourceColumnIndex >= 0 && desiredColumnIndex > sourceColumnIndex
				? desiredColumnIndex - 1
				: desiredColumnIndex;
		},
		[overviewWorldWidth, workspace.layout],
	);

	const columnPaneCountByPaneId = useMemo(() => {
		const columns: OverviewColumnRect[] = [];
		collectOverviewColumnRects(workspace.layout, 0, overviewWorldWidth, columns);
		const counts = new Map<string, number>();
		for (const column of columns) {
			const count = column.paneIds.length;
			for (const paneId of column.paneIds) counts.set(paneId, count);
		}
		return counts;
	}, [overviewWorldWidth, workspace.layout]);

	const canMovePaneToNewColumn = useCallback(
		(paneId: string) => (columnPaneCountByPaneId.get(paneId) ?? 0) > 1,
		[columnPaneCountByPaneId],
	);

	const handleMovePaneToColumn = useCallback(
		(paneId: string, columnIndex: number) => {
			const normalizedColumnIndex = resolveNormalizedColumnIndex(paneId, columnIndex);
			applyLayout((layout) => movePaneToColumnIndex(layout, paneId, normalizedColumnIndex));
			onFocusPane(paneId);
		},
		[applyLayout, onFocusPane, resolveNormalizedColumnIndex],
	);

	const handleMovePaneToNewColumn = useCallback(
		(paneId: string) => {
			if (!canMovePaneToNewColumn(paneId)) return;
			const columns: OverviewColumnRect[] = [];
			collectOverviewColumnRects(layoutRef.current, 0, overviewWorldWidth, columns);
			const sourceColumnIndex = columns.findIndex((columnRect) => columnRect.paneIds.includes(paneId));
			if (sourceColumnIndex < 0) return;
			const normalizedColumnIndex = resolveNormalizedColumnIndex(paneId, sourceColumnIndex + 1);
			applyLayout((layout) => movePaneToColumnIndex(layout, paneId, normalizedColumnIndex));
			onFocusPane(paneId);
		},
		[applyLayout, canMovePaneToNewColumn, onFocusPane, overviewWorldWidth, resolveNormalizedColumnIndex],
	);

	const handleMoveTab = useCallback(
		(sourcePaneId: string, tabId: string, targetPaneId: string) => {
			applyLayout((layout) => moveTabToPane(layout, sourcePaneId, tabId, targetPaneId, workspace.path));
			onFocusPane(targetPaneId);
		},
		[applyLayout, onFocusPane, workspace.path],
	);

	const handleDropTabToPane = useCallback(
		(sourcePaneId: string, tabId: string, targetPaneId: string, position: PaneDropPosition) => {
			if (position === "center") {
				handleMoveTab(sourcePaneId, tabId, targetPaneId);
				return;
			}

			const splitDirection: SplitDirection = position === "left" || position === "right" ? "vertical" : "horizontal";
			let destinationPaneId: string | null = null;

			applyLayout((layout) => {
				const paneIdsBefore = new Set(collectPaneIds(layout));
				let splitLayout = splitNode(layout, targetPaneId, splitDirection, workspace.path);
				const paneIdsAfter = collectPaneIds(splitLayout);
				const insertedPaneId = paneIdsAfter.find((paneId) => !paneIdsBefore.has(paneId)) ?? null;
				if (!insertedPaneId) return layout;

				if (position === "left" || position === "top") {
					splitLayout = swapPanes(splitLayout, targetPaneId, insertedPaneId);
				}

				destinationPaneId = insertedPaneId;
				return moveTabToPane(splitLayout, sourcePaneId, tabId, insertedPaneId, workspace.path);
			});

			if (destinationPaneId && findPaneById(layoutRef.current, destinationPaneId)) {
				onFocusPane(destinationPaneId);
			}
		},
		[applyLayout, handleMoveTab, onFocusPane, workspace.path],
	);

	const handleBeginFileTreeResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
		const startClientX = event.clientX;
		const startWidth = fileTreeWidth;

		const handleMove = (moveEvent: MouseEvent) => {
			const delta = moveEvent.clientX - startClientX;
			onFileTreeWidthChange(Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, startWidth + delta)));
		};

		const handleUp = () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
			document.body.classList.remove("is-resizing");
		};

		document.body.classList.add("is-resizing");
		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
	}, [fileTreeWidth, onFileTreeWidthChange]);

	const handleBeginGitPaneResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
		const startClientX = event.clientX;
		const startWidth = gitPaneWidth;

		const handleMove = (moveEvent: MouseEvent) => {
			const delta = startClientX - moveEvent.clientX;
			onGitPaneWidthChange(Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, startWidth + delta)));
		};

		const handleUp = () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
			document.body.classList.remove("is-resizing");
		};

		document.body.classList.add("is-resizing");
		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
	}, [gitPaneWidth, onGitPaneWidthChange]);

	const handleCloseTab = useCallback(
		(paneId: string, tabId: string) => {
			const pane = findPaneById(layoutRef.current, paneId);
			const tab = pane?.tabs.find((item) => item.id === tabId);
			if (!tab || !pane) return;
			if ((tab.kind === "editor" || tab.kind === "markdown") && tab.dirty) {
				const shouldClose = window.confirm(`Discard unsaved changes in ${tab.title}?`);
				if (!shouldClose) return;
			}
			if (pane.tabs.length <= 1) {
				handleClosePane(paneId);
				return;
			}
			if (isTerminalTab(tab)) {
				sessionManager.closeSession(tab.id);
			}
			applyLayout((layout) => closeTab(layout, paneId, tabId, workspace.path));
		},
		[applyLayout, handleClosePane, sessionManager, workspace.path],
	);

	const handleBeginPaneShiftDrag = useCallback(
		(paneId: string, clientX: number, clientY: number) => {
			onFocusPane(paneId);
			setOverviewSeedDrag({ paneId, clientX, clientY });
			onOpenOverview();
		},
		[onFocusPane, onOpenOverview],
	);

	const handleTogglePaneZoom = useCallback(
		(paneId: string) => {
			onFocusPane(paneId);
			if (zoomedPaneId === paneId) {
				setZoomedPaneId(null);
				window.requestAnimationFrame(() => {
					const container = layoutRootRef.current;
					const paneElement = paneElementsRef.current.get(paneId);
					if (!container || !paneElement) return;
					revealFocusedPane(container, paneElement, "center");
				});
				return;
			}
			setZoomedPaneId(paneId);
		},
		[onFocusPane, zoomedPaneId],
	);

	const handleOverviewMovePane = useCallback(
		(sourcePaneId: string, targetPaneId: string, position: PaneDropPosition) => {
			if (position === "center") {
				onSwapPanes(sourcePaneId, targetPaneId);
				onFocusPane(sourcePaneId);
				return;
			}

			applyLayout((layout) => movePane(layout, sourcePaneId, targetPaneId, position));
			onFocusPane(sourcePaneId);
		},
		[applyLayout, onFocusPane, onSwapPanes],
	);

	const zoomedPane = !overviewOpen && zoomedPaneId ? findPaneById(workspace.layout, zoomedPaneId) : null;
	const minimapWorldWidth = (Math.max(getLayoutWidthUnits(workspace.layout), WIDTH_UNIT_BASE) / WIDTH_UNIT_BASE) * 100;
	const minimapWorldHeight = 100;
	const minimapAspectRatio = minimapWorldWidth / minimapWorldHeight;
	const minimapPaneRects = useMemo(() => {
		const rects: OverviewPaneRect[] = [];
		collectOverviewPaneRects(workspace.layout, 0, 0, minimapWorldWidth, minimapWorldHeight, rects);
		return rects;
	}, [minimapWorldHeight, minimapWorldWidth, workspace.layout]);

	const focusPaneFromMap = useCallback(
		(paneId: string) => {
			onFocusPane(paneId);
			const container = layoutRootRef.current;
			const paneElement = paneElementsRef.current.get(paneId);
			if (!container || !paneElement) return;
			revealFocusedPane(container, paneElement, "center");
			requestAnimationFrame(() => {
				const textarea = paneElement.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
				textarea?.focus();
			});
		},
		[onFocusPane],
	);

	const showMinimap = !overviewOpen && minimapPaneRects.length > 1;

	return (
		<div className="workspace-root">
			<div className="workspace-content">
				{fileTreeOpen ? (
					<aside className="workspace-file-tree-dock" style={{ width: `${fileTreeWidth}px` }}>
						<FileTreeSidebar rootPath={workspace.path} onOpenFile={onOpenFile} />
						<div
							className="workspace-file-tree-resizer"
							onMouseDown={handleBeginFileTreeResize}
							role="separator"
							aria-label="Resize file tree"
						/>
					</aside>
				) : null}
				<div
					className="workspace-canvas-shell"
					style={{
						...(fileTreeOpen ? { transform: `translateX(${fileTreeWidth}px)` } : {}),
						...(gitPaneOpen ? { paddingRight: `${gitPaneWidth}px` } : {}),
					}}
				>
					<div
						ref={layoutRootRef}
						className={`layout-root ${overviewOpen ? "overview-open" : ""} ${middlePanning ? "middle-panning" : ""}`}
						onMouseDownCapture={(event) => {
							if (overviewOpen) return;
							if (event.button !== 1) return;
							event.preventDefault();
							event.stopPropagation();
							const container = layoutRootRef.current;
							if (!container) return;
							if (middlePanMomentumRafRef.current !== null) {
								window.cancelAnimationFrame(middlePanMomentumRafRef.current);
								middlePanMomentumRafRef.current = null;
							}
							middlePanVelocityRef.current = { x: 0, y: 0 };
							middlePanLastMoveRef.current = { x: event.clientX, y: event.clientY, time: performance.now() };
							middlePanStateRef.current = {
								startClientX: event.clientX,
								startClientY: event.clientY,
								originScrollLeft: container.scrollLeft,
								originScrollTop: container.scrollTop,
							};
							setMiddlePanning(true);
						}}
						onAuxClick={(event) => {
							if (event.button === 1) {
								event.preventDefault();
							}
						}}
					>
						{overviewOpen ? (
							<OverviewCanvas
								layout={workspace.layout}
								focusedPaneId={focusedPaneId}
								initialDrag={overviewSeedDrag}
								onConsumeInitialDrag={() => setOverviewSeedDrag(null)}
								onFocusPane={onFocusPane}
								onMovePane={handleOverviewMovePane}
								onInsertColumn={handleMovePaneToColumn}
								onClosePane={handleClosePane}
								onExitOverview={onExitOverview}
							/>
						) : (
							<div
								className="layout-canvas"
								style={{
									width: zoomedPane ? "100%" : `${(Math.max(getLayoutWidthUnits(workspace.layout), WIDTH_UNIT_BASE) / WIDTH_UNIT_BASE) * 100}%`,
									minWidth: "100%",
								}}
							>
								{zoomedPane ? (
									<div className="layout-leaf pane-zoom-shell">
										<TerminalPane
											pane={zoomedPane}
											accent={accent}
											theme={theme}
											cwd={workspace.path}
											focused
											zoomed
											onFocus={() => onFocusPane(zoomedPane.id)}
											onMoveToNewColumn={() => handleMovePaneToNewColumn(zoomedPane.id)}
											canMoveToNewColumn={canMovePaneToNewColumn(zoomedPane.id)}
											onSplitVertical={() => onSplitPane(zoomedPane.id, "vertical")}
											onSplitHorizontal={() => onSplitPane(zoomedPane.id, "horizontal")}
											onClose={() => handleClosePane(zoomedPane.id)}
											onAddTab={() => applyLayout((layout) => addTabToPane(layout, zoomedPane.id, workspace.path))}
											onAddBrowserTab={() => applyLayout((layout) => addBrowserTabToPane(layout, zoomedPane.id))}
											onSelectTab={(tabId) => applyLayout((layout) => setActiveTab(layout, zoomedPane.id, tabId))}
											onCloseTab={(tabId) => handleCloseTab(zoomedPane.id, tabId)}
											onMoveTab={handleMoveTab}
											onDropTabToPane={(sourcePaneId, tabId, position) => handleDropTabToPane(sourcePaneId, tabId, zoomedPane.id, position)}
											onToggleZoom={() => handleTogglePaneZoom(zoomedPane.id)}
											onBeginShiftDrag={(clientX, clientY) => handleBeginPaneShiftDrag(zoomedPane.id, clientX, clientY)}
											onUpdateTabMeta={(tabId, patch) => applyLayout((layout) => updateTabMeta(layout, zoomedPane.id, tabId, patch))}
											onOpenFile={onOpenFile}
											onUpdateTab={(tabId, updater) => onUpdateTab(zoomedPane.id, tabId, updater)}
										/>
									</div>
								) : (
									<LayoutView
										node={workspace.layout}
										accent={accent}
										theme={theme}
										cwd={workspace.path}
										focusedPaneId={focusedPaneId}
										zoomedPaneId={zoomedPaneId}
										onFocusPane={onFocusPane}
										onSplit={(paneId, direction) => onSplitPane(paneId, direction)}
										onMovePaneToNewColumn={handleMovePaneToNewColumn}
										canMovePaneToNewColumn={canMovePaneToNewColumn}
										onClosePane={handleClosePane}
										onAddTab={(paneId) => applyLayout((layout) => addTabToPane(layout, paneId, workspace.path))}
										onAddBrowserTab={(paneId) => applyLayout((layout) => addBrowserTabToPane(layout, paneId))}
										onSelectTab={(paneId, tabId) => applyLayout((layout) => setActiveTab(layout, paneId, tabId))}
										onCloseTab={handleCloseTab}
										onMoveTab={handleMoveTab}
										onDropTabToPane={handleDropTabToPane}
										onTogglePaneZoom={handleTogglePaneZoom}
										onBeginPaneShiftDrag={handleBeginPaneShiftDrag}
										onResizeHorizontalSplit={(splitId, ratio) => applyLayout((layout) => updateSplitRatio(layout, splitId, ratio))}
										onResizeVerticalSplitBranch={(splitId, branch, deltaRatio) =>
											applyLayout((layout) => resizeVerticalSplitByDelta(layout, splitId, deltaRatio, branch))
										}
										onRegisterPaneElement={registerPaneElement}
										onUpdateTabMeta={(paneId, tabId, patch) => applyLayout((layout) => updateTabMeta(layout, paneId, tabId, patch))}
										onOpenFile={(filePath) => onOpenFile(filePath)}
										onUpdateTab={onUpdateTab}
									/>
								)}
							</div>
						)}
					</div>
				</div>
				{gitPaneOpen ? (
					<aside className="workspace-git-dock" style={{ width: `${gitPaneWidth}px` }}>
						<div
							className="workspace-git-resizer"
							onMouseDown={handleBeginGitPaneResize}
							role="separator"
							aria-label="Resize git pane"
						/>
						<GitSidebar workspacePath={workspace.path} git={workspace.git} onRefresh={onRefreshWorkspaceGit} />
					</aside>
				) : null}
			</div>
			<div className={`workspace-corner-stack ${showMinimap ? "with-minimap" : ""}`}>
				<div className="workspace-corner-controls">
					<button
						type="button"
						className={`icon-button ${overviewOpen ? "active" : ""}`}
						onClick={overviewOpen ? onExitOverview : onOpenOverview}
						aria-label={overviewOpen ? "Exit overview" : "Open overview"}
					>
						⊞
					</button>
					<div className="new-pane-menu-wrap" ref={newPaneMenuRef}>
						{newPaneMenuOpen ? (
							<div className="new-pane-menu" role="menu" aria-label="Choose pane type">
								<button
									type="button"
									className="new-pane-menu-item"
									onClick={() => {
										setNewPaneMenuOpen(false);
										onAddPane();
									}}
								>
									New Terminal Pane
								</button>
								<button
									type="button"
									className="new-pane-menu-item"
									onClick={() => {
										setNewPaneMenuOpen(false);
										onAddBrowserPane();
									}}
								>
									New Browser Pane
								</button>
							</div>
						) : null}
						<button
							type="button"
							className="new-pane-button workspace-corner-new-pane"
							onClick={() => setNewPaneMenuOpen((current) => !current)}
							aria-label="Add a new pane"
						>
							<span className="new-pane-plus">+</span> New Pane
						</button>
					</div>
				</div>
				{showMinimap ? (
					<div
						className="pane-minimap"
						style={{ ["--minimap-aspect" as string]: String(minimapAspectRatio) }}
						role="navigation"
						aria-label="Pane minimap"
						onDoubleClick={onOpenOverview}
					>
						<div className="pane-minimap-track">
							{minimapPaneRects.map((rect) => {
								const activeTab = rect.pane.tabs.find((tab) => tab.id === rect.pane.activeTabId) ?? rect.pane.tabs[0];
								return (
									<div
										key={rect.pane.id}
										className={`pane-minimap-pane ${focusedPaneId === rect.pane.id ? "active" : ""}`}
										style={{
											left: `${(rect.x / minimapWorldWidth) * 100}%`,
											top: `${(rect.y / minimapWorldHeight) * 100}%`,
											width: `${(rect.width / minimapWorldWidth) * 100}%`,
											height: `${(rect.height / minimapWorldHeight) * 100}%`,
										}}
										onClick={() => focusPaneFromMap(rect.pane.id)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												focusPaneFromMap(rect.pane.id);
											}
										}}
										role="button"
										tabIndex={0}
										aria-label={`Focus pane ${activeTab?.title ?? "terminal"}`}
										title={activeTab?.title ?? "terminal"}
									/>
								);
							})}
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
