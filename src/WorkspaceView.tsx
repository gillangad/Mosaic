import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { TerminalPane } from "./components/TerminalPane";
import {
	addTabToPane,
	closeTab,
	COLUMN_INSERT_WIDTH_UNITS,
	findFirstPaneId,
	findPaneById,
	getLayoutWidthUnits,
	movePane,
	movePaneToColumnIndex,
	moveTabToPane,
	removePane,
	resizeVerticalSplitByDelta,
	setActiveTab,
	updateSplitRatio,
	updateTabMeta,
	type PaneDropPosition,
} from "./core/layout";
import type { LayoutNode, PaneModel, SplitDirection, TerminalTabModel, WorkspaceModel } from "./core/models";
import type { MosaicTheme } from "./core/themes";
import { useSessionManager } from "./core/terminal-backend-context";

type FocusMode = "default" | "center" | "edge";

interface LayoutViewProps {
	node: LayoutNode;
	accent: string;
	theme: MosaicTheme;
	cwd: string;
	focusedPaneId?: string;
	zoomedPaneId: string | null;
	onFocusPane: (paneId: string) => void;
	onSplit: (paneId: string, direction: SplitDirection) => void;
	onClosePane: (paneId: string) => void;
	onAddTab: (paneId: string) => void;
	onSelectTab: (paneId: string, tabId: string) => void;
	onCloseTab: (paneId: string, tabId: string) => void;
	onMoveTab: (sourcePaneId: string, tabId: string, targetPaneId: string) => void;
	onTogglePaneZoom: (paneId: string) => void;
	onResize: (splitId: string, ratio: number) => void;
	onRegisterPaneElement: (paneId: string, element: HTMLDivElement | null) => void;
	onUpdateTabMeta: (
		paneId: string,
		tabId: string,
		patch: Partial<Pick<TerminalTabModel, "status" | "shellLabel" | "message" | "title">>,
	) => void;
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
	onClosePane,
	onAddTab,
	onSelectTab,
	onCloseTab,
	onMoveTab,
	onTogglePaneZoom,
	onResize,
	onRegisterPaneElement,
	onUpdateTabMeta,
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
					onSplitVertical={() => onSplit(node.pane.id, "vertical")}
					onSplitHorizontal={() => onSplit(node.pane.id, "horizontal")}
					onClose={() => onClosePane(node.pane.id)}
					onAddTab={() => onAddTab(node.pane.id)}
					onSelectTab={(tabId) => onSelectTab(node.pane.id, tabId)}
					onCloseTab={(tabId) => onCloseTab(node.pane.id, tabId)}
					onMoveTab={onMoveTab}
					onToggleZoom={() => onTogglePaneZoom(node.pane.id)}
					onUpdateTabMeta={(tabId, patch) => onUpdateTabMeta(node.pane.id, tabId, patch)}
				/>
			</div>
		);
	}

	const beginResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
		const container = event.currentTarget.parentElement;
		if (!container) return;

		const rect = container.getBoundingClientRect();
		const handleMove = (moveEvent: MouseEvent) => {
			const nextRatio =
				node.direction === "vertical"
					? (moveEvent.clientX - rect.left) / rect.width
					: (moveEvent.clientY - rect.top) / rect.height;
			onResize(node.id, nextRatio);
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
					onClosePane={onClosePane}
					onAddTab={onAddTab}
					onSelectTab={onSelectTab}
					onCloseTab={onCloseTab}
					onMoveTab={onMoveTab}
					onTogglePaneZoom={onTogglePaneZoom}
					onResize={onResize}
					onRegisterPaneElement={onRegisterPaneElement}
					onUpdateTabMeta={onUpdateTabMeta}
				/>
			</div>
			<button
				type="button"
				className={`layout-resizer layout-resizer-${node.direction}`}
				onMouseDown={beginResize}
				aria-label={node.direction === "vertical" ? "Resize panes horizontally" : "Resize panes vertically"}
			/>
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
					onClosePane={onClosePane}
					onAddTab={onAddTab}
					onSelectTab={onSelectTab}
					onCloseTab={onCloseTab}
					onMoveTab={onMoveTab}
					onTogglePaneZoom={onTogglePaneZoom}
					onResize={onResize}
					onRegisterPaneElement={onRegisterPaneElement}
					onUpdateTabMeta={onUpdateTabMeta}
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
const OVERVIEW_COLUMN_INSERT_WIDTH_WORLD = COLUMN_INSERT_WIDTH_UNITS * 1100;

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

	const startDrag = useCallback((paneId: string, clientX: number, clientY: number) => {
		setDragState({ sourcePaneId: paneId, startClientX: clientX, startClientY: clientY, clientX, clientY, moved: false });
		setHoverDrop(null);
		setColumnInsertIndex(null);
	}, []);

	useEffect(() => {
		if (!dragState) return;

		const handleMove = (event: MouseEvent) => {
			const deltaX = event.clientX - dragState.startClientX;
			const deltaY = event.clientY - dragState.startClientY;
			const moved = dragState.moved || Math.hypot(deltaX, deltaY) > moveThreshold;
			setDragState((current) => (current ? { ...current, clientX: event.clientX, clientY: event.clientY, moved } : current));

			const nextColumnInsertIndex = moved && onInsertColumn && paneRects.length > 1
				? resolveColumnInsert?.(event.clientX, event.clientY, columnInsertIndex) ?? null
				: null;
			setColumnInsertIndex(nextColumnInsertIndex);

			const worldPoint = toWorld(event.clientX, event.clientY);
			if (!worldPoint || nextColumnInsertIndex !== null) {
				setHoverDrop(null);
				return;
			}

			setHoverDrop(hitTestPaneRects(paneRects, dragState.sourcePaneId, worldPoint.x, worldPoint.y));
		};

		const handleUp = () => {
			if (dragState.moved && columnInsertIndex !== null && onInsertColumn) {
				onInsertColumn(dragState.sourcePaneId, columnInsertIndex);
			} else if (dragState.moved && hoverDrop) {
				onMovePane(dragState.sourcePaneId, hoverDrop.targetPaneId, hoverDrop.position);
			} else if (!dragState.moved && onClickPane) {
				onClickPane(dragState.sourcePaneId);
			}
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
	}, [columnInsertIndex, dragState, hoverDrop, moveThreshold, onClickPane, onInsertColumn, onMovePane, paneRects, resolveColumnInsert, toWorld]);

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
	onFocusPane: (paneId: string) => void;
	onMovePane: (sourcePaneId: string, targetPaneId: string, position: PaneDropPosition) => void;
	onInsertColumn: (sourcePaneId: string, columnIndex: number) => void;
	onExitOverview: () => void;
}

function OverviewCanvas({ layout, focusedPaneId, onFocusPane, onMovePane, onInsertColumn, onExitOverview }: OverviewCanvasProps) {
	const sessionManager = useSessionManager();
	const stageRef = useRef<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState({ width: 1, height: 1 });
	const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
	const [panState, setPanState] = useState<null | { startClientX: number; startClientY: number; originX: number; originY: number }>(null);

	const contentWidth = Math.max(getLayoutWidthUnits(layout), 1) * 1100;
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
		const fitScale = Math.min((viewport.width - padding) / contentWidth, (viewport.height - padding) / contentHeight);
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
		if (!panState) return;

		const handleMove = (event: MouseEvent) => {
			setCamera((current) => ({
				...current,
				x: panState.originX + (event.clientX - panState.startClientX),
				y: panState.originY + (event.clientY - panState.startClientY),
			}));
		};

		const handleUp = () => setPanState(null);

		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
		return () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
		};
	}, [panState]);

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
	const edgeGuideTop = camera.y;
	const edgeGuideHeight = contentHeight * camera.scale;
	const worldLeft = camera.x;
	const worldRight = camera.x + contentWidth * camera.scale;
	const columnInsertPreview = showOverviewColumnTargets && columnInsertIndex !== null && draggedPane
		? {
			label:
				columnInsertIndex === 0
					? "New left column"
					: columnInsertIndex === columnRects.length
						? "New right column"
						: "Insert column",
			title: draggedActiveTab?.title ?? "terminal",
			tabCount: draggedPane.tabs.length,
			preview: draggedPreview,
			lineLeft:
				columnInsertIndex === 0
					? worldLeft
					: columnInsertIndex === columnRects.length
						? worldRight
						: camera.x + columnRects[columnInsertIndex].x * camera.scale,
			ghostLeft:
				columnInsertIndex === 0
					? worldLeft
					: columnInsertIndex === columnRects.length
						? worldRight
						: camera.x + columnRects[columnInsertIndex].x * camera.scale,
			ghostWidth: OVERVIEW_COLUMN_INSERT_WIDTH_WORLD * camera.scale,
			top: camera.y,
			height: contentHeight * camera.scale,
		}
		: null;

	return (
		<div
			ref={stageRef}
			className="overview-stage"
			onMouseDown={(event) => {
				if (event.button !== 0) return;
				const target = event.target as HTMLElement;
				if (target.closest(".overview-pane-card")) return;
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
			{showOverviewColumnTargets ? (
				<>
					<div
						className={`overview-edge-drop-zone left ${columnInsertIndex === 0 ? "active" : ""}`}
						style={{
							left: `${worldLeft - OVERVIEW_COLUMN_INSERT_THRESHOLD_PX}px`,
							top: `${edgeGuideTop}px`,
							height: `${edgeGuideHeight}px`,
						}}
					>
						<div className="overview-edge-drop-zone-label">New left column</div>
					</div>
					<div
						className={`overview-edge-drop-zone right ${columnInsertIndex === columnRects.length ? "active" : ""}`}
						style={{
							left: `${worldRight}px`,
							top: `${edgeGuideTop}px`,
							height: `${edgeGuideHeight}px`,
						}}
					>
						<div className="overview-edge-drop-zone-label">New right column</div>
					</div>
				</>
			) : null}
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
							<div className="overview-pane-header">{activeTab?.title ?? "terminal"}</div>
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
	overviewOpen: boolean;
	focusedPaneId?: string;
	onExitOverview: () => void;
	onOpenOverview: () => void;
	onAddPane: () => void;
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
	overviewOpen,
	focusedPaneId,
	onExitOverview,
	onOpenOverview,
	onAddPane,
	onFocusPane,
	onSwapPanes,
	onSplitPane,
	onUpdateLayout,
}: WorkspaceViewProps) {
	const sessionManager = useSessionManager();
	const layoutRootRef = useRef<HTMLDivElement | null>(null);
	const paneElementsRef = useRef(new Map<string, HTMLDivElement>());
	const [zoomedPaneId, setZoomedPaneId] = useState<string | null>(null);
	const [middlePanning, setMiddlePanning] = useState(false);

	const middlePanStateRef = useRef<null | {
		startClientX: number;
		startClientY: number;
		originScrollLeft: number;
		originScrollTop: number;
	}>(null);

	const registerPaneElement = useCallback((paneId: string, element: HTMLDivElement | null) => {
		if (!element) {
			paneElementsRef.current.delete(paneId);
			return;
		}
		paneElementsRef.current.set(paneId, element);
	}, []);

	useEffect(() => {
		setZoomedPaneId(null);
	}, [workspace.id]);

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
		};

		const stopMiddlePan = () => {
			middlePanStateRef.current = null;
			setMiddlePanning(false);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", stopMiddlePan);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", stopMiddlePan);
		};
	}, [middlePanning]);

	const handleClosePane = useCallback(
		(paneId: string) => {
			const pane = findPaneById(workspace.layout, paneId);
			if (pane) {
				for (const tab of pane.tabs) sessionManager.closeSession(tab.id);
			}
			onUpdateLayout(removePane(workspace.layout, paneId) ?? workspace.layout);
			setZoomedPaneId((current) => (current === paneId ? null : current));
		},
		[onUpdateLayout, sessionManager, workspace.layout],
	);

	const handleMovePaneToColumn = useCallback(
		(paneId: string, columnIndex: number) => {
			const columns: OverviewColumnRect[] = [];
			collectOverviewColumnRects(workspace.layout, 0, Math.max(getLayoutWidthUnits(workspace.layout), 1) * 1100, columns);
			const sourceColumnIndex = columns.findIndex((columnRect) => columnRect.paneIds.includes(paneId));
			const sourceColumnPaneCount = sourceColumnIndex >= 0 ? columns[sourceColumnIndex]?.paneIds.length ?? 0 : 0;
			const normalizedColumnIndex = sourceColumnPaneCount === 1 && sourceColumnIndex >= 0 && columnIndex > sourceColumnIndex ? columnIndex - 1 : columnIndex;
			onUpdateLayout(movePaneToColumnIndex(workspace.layout, paneId, normalizedColumnIndex));
			onFocusPane(paneId);
		},
		[onFocusPane, onUpdateLayout, workspace.layout],
	);

	const handleMoveTab = useCallback(
		(sourcePaneId: string, tabId: string, targetPaneId: string) => {
			onUpdateLayout(moveTabToPane(workspace.layout, sourcePaneId, tabId, targetPaneId, workspace.path));
			onFocusPane(targetPaneId);
		},
		[onFocusPane, onUpdateLayout, workspace.layout, workspace.path],
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

			onUpdateLayout(movePane(workspace.layout, sourcePaneId, targetPaneId, position));
			onFocusPane(sourcePaneId);
		},
		[onFocusPane, onSwapPanes, onUpdateLayout, workspace.layout],
	);

	const zoomedPane = !overviewOpen && zoomedPaneId ? findPaneById(workspace.layout, zoomedPaneId) : null;
	const minimapPaneRects = useMemo(() => {
		const rects: OverviewPaneRect[] = [];
		collectOverviewPaneRects(workspace.layout, 0, 0, 100, 100, rects);
		return rects;
	}, [workspace.layout]);

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
						onFocusPane={onFocusPane}
						onMovePane={handleOverviewMovePane}
						onInsertColumn={handleMovePaneToColumn}
						onExitOverview={onExitOverview}
					/>
				) : (
					<div
						className="layout-canvas"
						style={{
							width: zoomedPane ? "100%" : `${Math.max(getLayoutWidthUnits(workspace.layout), 1) * 100}%`,
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
									onSplitVertical={() => onSplitPane(zoomedPane.id, "vertical")}
									onSplitHorizontal={() => onSplitPane(zoomedPane.id, "horizontal")}
									onClose={() => handleClosePane(zoomedPane.id)}
									onAddTab={() => onUpdateLayout(addTabToPane(workspace.layout, zoomedPane.id, workspace.path))}
									onSelectTab={(tabId) => onUpdateLayout(setActiveTab(workspace.layout, zoomedPane.id, tabId))}
									onCloseTab={(tabId) => {
										sessionManager.closeSession(tabId);
										onUpdateLayout(closeTab(workspace.layout, zoomedPane.id, tabId, workspace.path));
									}}
									onMoveTab={handleMoveTab}
									onToggleZoom={() => handleTogglePaneZoom(zoomedPane.id)}
									onUpdateTabMeta={(tabId, patch) => onUpdateLayout(updateTabMeta(workspace.layout, zoomedPane.id, tabId, patch))}
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
								onClosePane={handleClosePane}
								onAddTab={(paneId) => onUpdateLayout(addTabToPane(workspace.layout, paneId, workspace.path))}
								onSelectTab={(paneId, tabId) => onUpdateLayout(setActiveTab(workspace.layout, paneId, tabId))}
								onCloseTab={(paneId, tabId) => {
									sessionManager.closeSession(tabId);
									onUpdateLayout(closeTab(workspace.layout, paneId, tabId, workspace.path));
								}}
								onMoveTab={handleMoveTab}
								onTogglePaneZoom={handleTogglePaneZoom}
								onResize={(splitId, ratio) => onUpdateLayout(updateSplitRatio(workspace.layout, splitId, ratio))}
								onRegisterPaneElement={registerPaneElement}
								onUpdateTabMeta={(paneId, tabId, patch) => onUpdateLayout(updateTabMeta(workspace.layout, paneId, tabId, patch))}
							/>
						)}
					</div>
				)}
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
					<button type="button" className="new-pane-button workspace-corner-new-pane" onClick={onAddPane} aria-label="Add a new pane">
						<span className="new-pane-plus">+</span> New Pane
					</button>
				</div>
				{showMinimap ? (
					<div className="pane-minimap" role="navigation" aria-label="Pane minimap" onDoubleClick={onOpenOverview}>
						<div className="pane-minimap-track">
							{minimapPaneRects.map((rect) => {
								const activeTab = rect.pane.tabs.find((tab) => tab.id === rect.pane.activeTabId) ?? rect.pane.tabs[0];
								return (
									<div
										key={rect.pane.id}
										className={`pane-minimap-pane ${focusedPaneId === rect.pane.id ? "active" : ""}`}
										style={{
											left: `${rect.x}%`,
											top: `${rect.y}%`,
											width: `${rect.width}%`,
											height: `${rect.height}%`,
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
