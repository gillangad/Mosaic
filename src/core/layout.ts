import type { LayoutNode, PaneLayoutNode, PaneModel, PaneStatus, PaneTabModel, SplitDirection, SplitLayoutNode, TerminalTabModel } from "./models";
import {
	createBrowserTab,
	createEditorTab,
	createFileTreeTab,
	createImageTab,
	createMarkdownTab,
	createPdfTab,
	createTerminalTab,
	getMonacoLanguage,
	isTerminalTab,
	normalizeFilePath,
} from "./pane-tabs";

export type FocusDirection = "left" | "right" | "up" | "down";
export type PaneDropPosition = "center" | "left" | "right" | "top" | "bottom";

type PathEntry = { node: SplitLayoutNode; branch: "first" | "second" };

export const WIDTH_UNIT_BASE = 100;
const DEFAULT_WIDTH_UNITS = WIDTH_UNIT_BASE;
const APPENDED_PANE_WIDTH_UNITS = WIDTH_UNIT_BASE / 2;
export const COLUMN_INSERT_WIDTH_UNITS = APPENDED_PANE_WIDTH_UNITS;
const MAX_BRANCH_EXPAND_UNITS = 200;

function getResizeCap() {
	return MAX_BRANCH_EXPAND_UNITS;
}

function clampWidthUnits(value: number) {
	return Math.max(0.01, value);
}

function getNodeWidthUnits(node: LayoutNode) {
	return clampWidthUnits(node.widthUnits ?? DEFAULT_WIDTH_UNITS);
}

function getBranchWidthUnits(node: SplitLayoutNode, branch: "first" | "second") {
	if (node.direction === "horizontal") return getNodeWidthUnits(node);
	return branch === "first" ? getNodeWidthUnits(node) * node.ratio : getNodeWidthUnits(node) * (1 - node.ratio);
}

function resizeLayoutWidth(node: LayoutNode, widthUnits: number): LayoutNode {
	const nextWidthUnits = clampWidthUnits(widthUnits);

	if (node.type === "pane") {
		return {
			...node,
			widthUnits: nextWidthUnits,
		};
	}

	if (node.direction === "horizontal") {
		return {
			...node,
			widthUnits: nextWidthUnits,
			first: resizeLayoutWidth(node.first, nextWidthUnits),
			second: resizeLayoutWidth(node.second, nextWidthUnits),
		};
	}

	const ratio = clampRatio(node.ratio ?? 0.5);
	return {
		...node,
		ratio,
		widthUnits: nextWidthUnits,
		first: resizeLayoutWidth(node.first, nextWidthUnits * ratio),
		second: resizeLayoutWidth(node.second, nextWidthUnits * (1 - ratio)),
	};
}

function findPath(root: LayoutNode, paneId: string): PathEntry[] | null {
	if (root.type === "pane") {
		return root.pane.id === paneId ? [] : null;
	}

	const firstPath = findPath(root.first, paneId);
	if (firstPath !== null) return [{ node: root, branch: "first" }, ...firstPath];

	const secondPath = findPath(root.second, paneId);
	if (secondPath !== null) return [{ node: root, branch: "second" }, ...secondPath];

	return null;
}

export function createPaneModel(workspacePath: string): PaneModel {
	const firstTab = createTerminalTab(workspacePath);
	return {
		id: crypto.randomUUID(),
		tabs: [firstTab],
		activeTabId: firstTab.id,
	};
}

export function createPaneModelFromTab(tab: PaneTabModel): PaneModel {
	return {
		id: crypto.randomUUID(),
		tabs: [tab],
		activeTabId: tab.id,
	};
}

export function createPaneNode(
	workspacePath: string,
	pane = createPaneModel(workspacePath),
	widthUnits = DEFAULT_WIDTH_UNITS,
): PaneLayoutNode {
	return {
		type: "pane",
		id: crypto.randomUUID(),
		pane,
		widthUnits: clampWidthUnits(widthUnits),
	};
}

export function countPanes(node: LayoutNode): number {
	if (node.type === "pane") return 1;
	return countPanes(node.first) + countPanes(node.second);
}

export function findFirstPaneId(node: LayoutNode): string {
	if (node.type === "pane") return node.pane.id;
	return findFirstPaneId(node.first);
}

export function findLastPaneId(node: LayoutNode): string {
	if (node.type === "pane") return node.pane.id;
	return findLastPaneId(node.second);
}

export function findPaneById(node: LayoutNode, paneId: string): PaneModel | null {
	if (node.type === "pane") return node.pane.id === paneId ? node.pane : null;
	return findPaneById(node.first, paneId) ?? findPaneById(node.second, paneId);
}

export function findTabById(node: LayoutNode, tabId: string): { paneId: string; tab: PaneTabModel } | null {
	if (node.type === "pane") {
		const tab = node.pane.tabs.find((item) => item.id === tabId);
		return tab ? { paneId: node.pane.id, tab } : null;
	}

	return findTabById(node.first, tabId) ?? findTabById(node.second, tabId);
}

export function findTabByFilePath(node: LayoutNode, filePath: string): { paneId: string; tabId: string } | null {
	const normalizedPath = normalizeFilePath(filePath);
	if (node.type === "pane") {
		const tab = node.pane.tabs.find((item) => {
			if (!("filePath" in item)) return false;
			return normalizeFilePath(item.filePath) === normalizedPath;
		});
		return tab ? { paneId: node.pane.id, tabId: tab.id } : null;
	}

	return findTabByFilePath(node.first, normalizedPath) ?? findTabByFilePath(node.second, normalizedPath);
}

export function findPaneIdWithTabKind(node: LayoutNode, kind: PaneTabModel["kind"]): string | null {
	if (node.type === "pane") {
		return node.pane.tabs.some((tab) => tab.kind === kind) ? node.pane.id : null;
	}

	return findPaneIdWithTabKind(node.first, kind) ?? findPaneIdWithTabKind(node.second, kind);
}

export function getAllTabIds(node: LayoutNode): string[] {
	if (node.type === "pane") return node.pane.tabs.map((tab) => tab.id);
	return [...getAllTabIds(node.first), ...getAllTabIds(node.second)];
}

export function getLayoutWidthUnits(node: LayoutNode) {
	return getNodeWidthUnits(node);
}

export function splitNode(node: LayoutNode, paneId: string, direction: SplitDirection, workspacePath: string): LayoutNode {
	if (node.type === "pane") {
		if (node.pane.id !== paneId) return node;

		const currentWidthUnits = getNodeWidthUnits(node);
		const firstWidthUnits = direction === "vertical" ? currentWidthUnits * 0.5 : currentWidthUnits;
		const secondWidthUnits = direction === "vertical" ? currentWidthUnits * 0.5 : currentWidthUnits;

		return {
			type: "split",
			id: crypto.randomUUID(),
			direction,
			ratio: 0.5,
			widthUnits: currentWidthUnits,
			first: resizeLayoutWidth(node, firstWidthUnits),
			second: createPaneNode(workspacePath, createPaneModel(workspacePath), secondWidthUnits),
		};
	}

	return {
		...node,
		widthUnits: getNodeWidthUnits(node),
		first: splitNode(node.first, paneId, direction, workspacePath),
		second: splitNode(node.second, paneId, direction, workspacePath),
	};
}

function removePaneInternal(node: LayoutNode, paneId: string, isRoot: boolean): LayoutNode | null {
	if (node.type === "pane") {
		return node.pane.id === paneId ? null : node;
	}

	const first = removePaneInternal(node.first, paneId, false);
	const second = removePaneInternal(node.second, paneId, false);

	if (!first && !second) return null;
	if (!first) {
		const survivingSecond = second as LayoutNode;
		const nextWidthUnits = isRoot ? Math.max(DEFAULT_WIDTH_UNITS, getNodeWidthUnits(survivingSecond)) : getNodeWidthUnits(node);
		return resizeLayoutWidth(survivingSecond, nextWidthUnits);
	}
	if (!second) {
		const survivingFirst = first as LayoutNode;
		const nextWidthUnits = isRoot ? Math.max(DEFAULT_WIDTH_UNITS, getNodeWidthUnits(survivingFirst)) : getNodeWidthUnits(node);
		return resizeLayoutWidth(survivingFirst, nextWidthUnits);
	}

	return {
		...node,
		widthUnits: getNodeWidthUnits(node),
		first,
		second,
	};
}

export function removePane(node: LayoutNode, paneId: string): LayoutNode | null {
	return removePaneInternal(node, paneId, true);
}

function clampRatio(value: number) {
	return Math.min(0.82, Math.max(0.18, value));
}

function mapPane(node: LayoutNode, paneId: string, updater: (pane: PaneModel) => PaneModel): LayoutNode {
	if (node.type === "pane") {
		if (node.pane.id !== paneId) return node;
		return {
			...node,
			pane: updater(node.pane),
		};
	}

	return {
		...node,
		widthUnits: getNodeWidthUnits(node),
		first: mapPane(node.first, paneId, updater),
		second: mapPane(node.second, paneId, updater),
	};
}

export function addTabToPane(node: LayoutNode, paneId: string, workspacePath: string): LayoutNode {
	return mapPane(node, paneId, (pane) => {
		const nextTab = createTerminalTab(workspacePath);
		return {
			...pane,
			tabs: [...pane.tabs, nextTab],
			activeTabId: nextTab.id,
		};
	});
}

export function addBrowserTabToPane(node: LayoutNode, paneId: string, initialUrl = "about:blank"): LayoutNode {
	return mapPane(node, paneId, (pane) => {
		const nextTab = createBrowserTab(initialUrl);
		return {
			...pane,
			tabs: [...pane.tabs, nextTab],
			activeTabId: nextTab.id,
		};
	});
}

export function addTabModelToPane(node: LayoutNode, paneId: string, tab: PaneTabModel): LayoutNode {
	return mapPane(node, paneId, (pane) => ({
		...pane,
		tabs: [...pane.tabs, tab],
		activeTabId: tab.id,
	}));
}

export function replacePaneTabs(node: LayoutNode, paneId: string, tabs: PaneTabModel[], activeTabId?: string): LayoutNode {
	return mapPane(node, paneId, (pane) => {
		const safeTabs = tabs.length > 0 ? tabs : pane.tabs;
		const nextActiveTabId = activeTabId && safeTabs.some((tab) => tab.id === activeTabId) ? activeTabId : safeTabs[0].id;
		return {
			...pane,
			tabs: safeTabs,
			activeTabId: nextActiveTabId,
		};
	});
}

export function appendPaneToRight(node: LayoutNode, workspacePath: string): LayoutNode {
	const existingWidthUnits = getNodeWidthUnits(node);
	const nextWidthUnits = existingWidthUnits + APPENDED_PANE_WIDTH_UNITS;

	return {
		type: "split",
		id: crypto.randomUUID(),
		direction: "vertical",
		ratio: existingWidthUnits / nextWidthUnits,
		widthUnits: nextWidthUnits,
		first: resizeLayoutWidth(node, existingWidthUnits),
		second: createPaneNode(workspacePath, createPaneModel(workspacePath), APPENDED_PANE_WIDTH_UNITS),
	};
}

export function prependPaneToLeft(node: LayoutNode, pane: PaneModel): LayoutNode {
	const existingWidthUnits = getNodeWidthUnits(node);
	const insertedWidthUnits = APPENDED_PANE_WIDTH_UNITS;
	const nextWidthUnits = existingWidthUnits + insertedWidthUnits;

	return {
		type: "split",
		id: crypto.randomUUID(),
		direction: "vertical",
		ratio: insertedWidthUnits / nextWidthUnits,
		widthUnits: nextWidthUnits,
		first: createPaneNodeFromModel(pane, insertedWidthUnits),
		second: resizeLayoutWidth(node, existingWidthUnits),
	};
}

interface PaneInsertResult {
	node: LayoutNode;
	inserted: boolean;
	deltaWidthUnits: number;
}

function insertPaneToRightInternal(node: LayoutNode, paneId: string, workspacePath: string): PaneInsertResult {
	if (node.type === "pane") {
		if (node.pane.id !== paneId) return { node, inserted: false, deltaWidthUnits: 0 };

		const currentWidthUnits = getNodeWidthUnits(node);
		const deltaWidthUnits = APPENDED_PANE_WIDTH_UNITS;
		const nextWidthUnits = currentWidthUnits + deltaWidthUnits;

		return {
			inserted: true,
			deltaWidthUnits,
			node: {
				type: "split",
				id: crypto.randomUUID(),
				direction: "vertical",
				ratio: currentWidthUnits / nextWidthUnits,
				widthUnits: nextWidthUnits,
				first: resizeLayoutWidth(node, currentWidthUnits),
				second: createPaneNode(workspacePath, createPaneModel(workspacePath), deltaWidthUnits),
			},
		};
	}

	const firstResult = insertPaneToRightInternal(node.first, paneId, workspacePath);
	if (firstResult.inserted) {
		if (node.direction === "vertical") {
			const firstWidthUnits = getNodeWidthUnits(firstResult.node);
			const secondWidthUnits = getBranchWidthUnits(node, "second");
			const nextWidthUnits = firstWidthUnits + secondWidthUnits;

			return {
				inserted: true,
				deltaWidthUnits: firstResult.deltaWidthUnits,
				node: {
					...node,
					widthUnits: nextWidthUnits,
					ratio: firstWidthUnits / nextWidthUnits,
					first: firstResult.node,
					second: resizeLayoutWidth(node.second, secondWidthUnits),
				},
			};
		}

		const nextWidthUnits = getNodeWidthUnits(node) + firstResult.deltaWidthUnits;
		return {
			inserted: true,
			deltaWidthUnits: firstResult.deltaWidthUnits,
			node: {
				...node,
				widthUnits: nextWidthUnits,
				first: resizeLayoutWidth(firstResult.node, nextWidthUnits),
				second: resizeLayoutWidth(node.second, nextWidthUnits),
			},
		};
	}

	const secondResult = insertPaneToRightInternal(node.second, paneId, workspacePath);
	if (secondResult.inserted) {
		if (node.direction === "vertical") {
			const firstWidthUnits = getBranchWidthUnits(node, "first");
			const secondWidthUnits = getNodeWidthUnits(secondResult.node);
			const nextWidthUnits = firstWidthUnits + secondWidthUnits;

			return {
				inserted: true,
				deltaWidthUnits: secondResult.deltaWidthUnits,
				node: {
					...node,
					widthUnits: nextWidthUnits,
					ratio: firstWidthUnits / nextWidthUnits,
					first: resizeLayoutWidth(node.first, firstWidthUnits),
					second: secondResult.node,
				},
			};
		}

		const nextWidthUnits = getNodeWidthUnits(node) + secondResult.deltaWidthUnits;
		return {
			inserted: true,
			deltaWidthUnits: secondResult.deltaWidthUnits,
			node: {
				...node,
				widthUnits: nextWidthUnits,
				first: resizeLayoutWidth(node.first, nextWidthUnits),
				second: resizeLayoutWidth(secondResult.node, nextWidthUnits),
			},
		};
	}

	return { node, inserted: false, deltaWidthUnits: 0 };
}

export function insertPaneToRightOf(node: LayoutNode, paneId: string, workspacePath: string): LayoutNode {
	const result = insertPaneToRightInternal(node, paneId, workspacePath);
	return result.node;
}

export function setActiveTab(node: LayoutNode, paneId: string, tabId: string): LayoutNode {
	return mapPane(node, paneId, (pane) => ({
		...pane,
		activeTabId: tabId,
	}));
}

export function swapPanes(node: LayoutNode, firstPaneId: string, secondPaneId: string): LayoutNode {
	if (firstPaneId === secondPaneId) return node;

	const firstPane = findPaneById(node, firstPaneId);
	const secondPane = findPaneById(node, secondPaneId);
	if (!firstPane || !secondPane) return node;

	const swapInternal = (current: LayoutNode): LayoutNode => {
		if (current.type === "pane") {
			if (current.pane.id === firstPaneId) return { ...current, pane: secondPane };
			if (current.pane.id === secondPaneId) return { ...current, pane: firstPane };
			return current;
		}

		return {
			...current,
			widthUnits: getNodeWidthUnits(current),
			first: swapInternal(current.first),
			second: swapInternal(current.second),
		};
	};

	return swapInternal(node);
}

function createPaneNodeFromModel(pane: PaneModel, widthUnits: number): PaneLayoutNode {
	return {
		type: "pane",
		id: crypto.randomUUID(),
		pane,
		widthUnits: clampWidthUnits(widthUnits),
	};
}

function insertPaneAtTarget(
	node: LayoutNode,
	targetPaneId: string,
	position: Exclude<PaneDropPosition, "center">,
	paneToInsert: PaneModel,
): LayoutNode {
	if (node.type === "pane") {
		if (node.pane.id !== targetPaneId) return node;

		const currentWidthUnits = getNodeWidthUnits(node);
		const direction: SplitDirection = position === "left" || position === "right" ? "vertical" : "horizontal";
		const firstIsInserted = position === "left" || position === "top";
		const insertedWidthUnits = direction === "vertical" ? currentWidthUnits * 0.5 : currentWidthUnits;
		const existingWidthUnits = direction === "vertical" ? currentWidthUnits * 0.5 : currentWidthUnits;
		const existingPaneNode = resizeLayoutWidth(node, existingWidthUnits);
		const insertedPaneNode = createPaneNodeFromModel(paneToInsert, insertedWidthUnits);

		return {
			type: "split",
			id: crypto.randomUUID(),
			direction,
			ratio: 0.5,
			widthUnits: currentWidthUnits,
			first: firstIsInserted ? insertedPaneNode : existingPaneNode,
			second: firstIsInserted ? existingPaneNode : insertedPaneNode,
		};
	}

	return {
		...node,
		widthUnits: getNodeWidthUnits(node),
		first: insertPaneAtTarget(node.first, targetPaneId, position, paneToInsert),
		second: insertPaneAtTarget(node.second, targetPaneId, position, paneToInsert),
	};
}

export function movePane(
	node: LayoutNode,
	sourcePaneId: string,
	targetPaneId: string,
	position: PaneDropPosition,
): LayoutNode {
	if (sourcePaneId === targetPaneId) return node;

	if (position === "center") {
		return swapPanes(node, sourcePaneId, targetPaneId);
	}

	const sourcePane = findPaneById(node, sourcePaneId);
	if (!sourcePane) return node;

	const layoutWithoutSource = removePane(node, sourcePaneId);
	if (!layoutWithoutSource) return node;
	if (!findPaneById(layoutWithoutSource, targetPaneId)) return node;

	return insertPaneAtTarget(layoutWithoutSource, targetPaneId, position, sourcePane);
}

export function detachPaneToSide(
	node: LayoutNode,
	sourcePaneId: string,
	side: "left" | "right",
): LayoutNode {
	const sourcePane = findPaneById(node, sourcePaneId);
	if (!sourcePane) return node;

	const layoutWithoutSource = removePane(node, sourcePaneId);
	if (!layoutWithoutSource) return node;

	const existingWidthUnits = getNodeWidthUnits(layoutWithoutSource);
	const insertedWidthUnits = APPENDED_PANE_WIDTH_UNITS;
	const totalWidthUnits = existingWidthUnits + insertedWidthUnits;
	const insertedNode = createPaneNodeFromModel(sourcePane, insertedWidthUnits);

	return {
		type: "split",
		id: crypto.randomUUID(),
		direction: "vertical",
		ratio: side === "left"
			? insertedWidthUnits / totalWidthUnits
			: existingWidthUnits / totalWidthUnits,
		widthUnits: totalWidthUnits,
		first: side === "left" ? insertedNode : resizeLayoutWidth(layoutWithoutSource, existingWidthUnits),
		second: side === "left" ? resizeLayoutWidth(layoutWithoutSource, existingWidthUnits) : insertedNode,
	};
}

function collectRootColumns(node: LayoutNode, result: LayoutNode[]) {
	if (node.type === "split" && node.direction === "vertical") {
		collectRootColumns(node.first, result);
		collectRootColumns(node.second, result);
		return;
	}

	result.push(node);
}

function columnContainsPane(node: LayoutNode, paneId: string): boolean {
	if (node.type === "pane") return node.pane.id === paneId;
	return columnContainsPane(node.first, paneId) || columnContainsPane(node.second, paneId);
}

function buildRootColumns(columns: LayoutNode[]): LayoutNode {
	if (columns.length === 1) {
		const widthUnits = getNodeWidthUnits(columns[0]);
		return resizeLayoutWidth(columns[0], widthUnits);
	}

	const [first, ...rest] = columns;
	const second = buildRootColumns(rest);
	const firstWidthUnits = getNodeWidthUnits(first);
	const secondWidthUnits = getNodeWidthUnits(second);
	const totalWidthUnits = firstWidthUnits + secondWidthUnits;

	return {
		type: "split",
		id: crypto.randomUUID(),
		direction: "vertical",
		ratio: firstWidthUnits / totalWidthUnits,
		widthUnits: totalWidthUnits,
		first: resizeLayoutWidth(first, firstWidthUnits),
		second: resizeLayoutWidth(second, secondWidthUnits),
	};
}

export function movePaneToColumnIndex(node: LayoutNode, sourcePaneId: string, columnIndex: number): LayoutNode {
	const sourcePane = findPaneById(node, sourcePaneId);
	if (!sourcePane) return node;

	const layoutWithoutSource = removePane(node, sourcePaneId);
	if (!layoutWithoutSource) return node;

	const columns: LayoutNode[] = [];
	collectRootColumns(layoutWithoutSource, columns);
	const clampedIndex = Math.max(0, Math.min(columnIndex, columns.length));
	if (clampedIndex === 0) return detachPaneToSide(node, sourcePaneId, "left");
	if (clampedIndex === columns.length) return detachPaneToSide(node, sourcePaneId, "right");

	const nextColumns = [...columns];
	nextColumns.splice(clampedIndex, 0, createPaneNodeFromModel(sourcePane, APPENDED_PANE_WIDTH_UNITS));
	return buildRootColumns(nextColumns);
}

export function moveColumnContainingPane(node: LayoutNode, paneId: string, delta: -1 | 1): LayoutNode {
	const columns: LayoutNode[] = [];
	collectRootColumns(node, columns);
	if (columns.length < 2) return node;
	const sourceIndex = columns.findIndex((column) => columnContainsPane(column, paneId));
	if (sourceIndex < 0) return node;
	const targetIndex = Math.max(0, Math.min(columns.length - 1, sourceIndex + delta));
	if (targetIndex === sourceIndex) return node;
	const nextColumns = [...columns];
	const [movedColumn] = nextColumns.splice(sourceIndex, 1);
	if (!movedColumn) return node;
	const insertionIndex = sourceIndex < targetIndex ? targetIndex : targetIndex;
	nextColumns.splice(insertionIndex, 0, movedColumn);
	return buildRootColumns(nextColumns);
}

export function closeTab(node: LayoutNode, paneId: string, tabId: string, workspacePath: string): LayoutNode {
	return mapPane(node, paneId, (pane) => {
		if (pane.tabs.length === 1) {
			const replacement = createTerminalTab(workspacePath);
			return {
				...pane,
				tabs: [replacement],
				activeTabId: replacement.id,
			};
		}

		const nextTabs = pane.tabs.filter((tab) => tab.id !== tabId);
		const nextActiveTabId = pane.activeTabId === tabId ? (nextTabs[0]?.id ?? pane.activeTabId) : pane.activeTabId;

		return {
			...pane,
			tabs: nextTabs,
			activeTabId: nextActiveTabId,
		};
	});
}

export function moveTabToPane(
	node: LayoutNode,
	sourcePaneId: string,
	tabId: string,
	targetPaneId: string,
	workspacePath: string,
): LayoutNode {
	if (sourcePaneId === targetPaneId) {
		return setActiveTab(node, targetPaneId, tabId);
	}

	const sourcePane = findPaneById(node, sourcePaneId);
	const targetPane = findPaneById(node, targetPaneId);
	if (!sourcePane || !targetPane) return node;

	const movingTab = sourcePane.tabs.find((tab) => tab.id === tabId);
	if (!movingTab) return node;

	const sourceIndex = sourcePane.tabs.findIndex((tab) => tab.id === tabId);
	const nextAfterSource = mapPane(node, sourcePaneId, (pane) => {
		const nextTabs = pane.tabs.filter((tab) => tab.id !== tabId);
		if (nextTabs.length === 0) {
			const replacement = createTerminalTab(workspacePath);
			return {
				...pane,
				tabs: [replacement],
				activeTabId: replacement.id,
			};
		}

		const fallbackTab = nextTabs[Math.max(0, sourceIndex - 1)] ?? nextTabs[0];
		return {
			...pane,
			tabs: nextTabs,
			activeTabId: pane.activeTabId === tabId ? fallbackTab.id : pane.activeTabId,
		};
	});

	return mapPane(nextAfterSource, targetPaneId, (pane) => {
		if (pane.tabs.some((tab) => tab.id === movingTab.id)) {
			return {
				...pane,
				activeTabId: movingTab.id,
			};
		}

		return {
			...pane,
			tabs: [...pane.tabs, movingTab],
			activeTabId: movingTab.id,
		};
	});
}

export function updatePaneTab(
	node: LayoutNode,
	paneId: string,
	tabId: string,
	updater: (tab: PaneTabModel) => PaneTabModel,
): LayoutNode {
	return mapPane(node, paneId, (pane) => ({
		...pane,
		tabs: pane.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
	}));
}

export function updateTabMeta(
	node: LayoutNode,
	paneId: string,
	tabId: string,
	patch: Partial<Pick<TerminalTabModel, "status" | "shellLabel" | "message" | "title">>,
): LayoutNode {
	return updatePaneTab(node, paneId, tabId, (tab) => (isTerminalTab(tab) ? { ...tab, ...patch } : tab));
}

export function updateSplitRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
	if (node.type === "pane") return node;
	if (node.id === splitId) {
		const widthUnits = getNodeWidthUnits(node);

		if (node.direction === "vertical") {
			const requestedRatio = Number.isFinite(ratio) ? ratio : node.ratio;
			const currentSecondWidthUnits = getBranchWidthUnits(node, "second");
			const requestedFirstWidthUnits = clampWidthUnits(widthUnits * requestedRatio);
			const nextFirstWidthUnits = Math.min(getResizeCap(), requestedFirstWidthUnits);
			const nextWidthUnits = nextFirstWidthUnits + currentSecondWidthUnits;
			const normalizedRatio = clampRatio(nextFirstWidthUnits / nextWidthUnits);
			return {
				...node,
				ratio: normalizedRatio,
				widthUnits: nextWidthUnits,
				first: resizeLayoutWidth(node.first, nextFirstWidthUnits),
				second: resizeLayoutWidth(node.second, currentSecondWidthUnits),
			};
		}

		const nextRatio = clampRatio(ratio);
		const firstWidthUnits = widthUnits;
		const secondWidthUnits = widthUnits;
		return {
			...node,
			ratio: nextRatio,
			widthUnits,
			first: resizeLayoutWidth(node.first, firstWidthUnits),
			second: resizeLayoutWidth(node.second, secondWidthUnits),
		};
	}

	const nextFirst = updateSplitRatio(node.first, splitId, ratio);
	const nextSecond = updateSplitRatio(node.second, splitId, ratio);

	if (node.direction === "vertical") {
		const nextFirstWidthUnits = getNodeWidthUnits(nextFirst);
		const nextSecondWidthUnits = getNodeWidthUnits(nextSecond);
		const nextWidthUnits = nextFirstWidthUnits + nextSecondWidthUnits;
		return {
			...node,
			ratio: clampRatio(nextFirstWidthUnits / nextWidthUnits),
			widthUnits: nextWidthUnits,
			first: resizeLayoutWidth(nextFirst, nextFirstWidthUnits),
			second: resizeLayoutWidth(nextSecond, nextSecondWidthUnits),
		};
	}

	const nextWidthUnits = Math.max(getNodeWidthUnits(nextFirst), getNodeWidthUnits(nextSecond));
	return {
		...node,
		widthUnits: nextWidthUnits,
		first: resizeLayoutWidth(nextFirst, nextWidthUnits),
		second: resizeLayoutWidth(nextSecond, nextWidthUnits),
	};
}

export function findAdjacentPaneId(root: LayoutNode, paneId: string, direction: FocusDirection): string | null {
	const path = findPath(root, paneId);
	if (!path) return null;

	const splitDir: SplitDirection = direction === "left" || direction === "right" ? "vertical" : "horizontal";

	for (let i = path.length - 1; i >= 0; i--) {
		const entry = path[i];
		if (entry.node.direction !== splitDir) continue;

		if ((direction === "right" || direction === "down") && entry.branch === "first") {
			return findFirstPaneId(entry.node.second);
		}
		if ((direction === "left" || direction === "up") && entry.branch === "second") {
			return findLastPaneId(entry.node.first);
		}
	}

	return null;
}

function resizeVerticalSplitPreserveSibling(
	node: SplitLayoutNode,
	branch: "first" | "second",
	direction: "left" | "right",
	step: number,
): LayoutNode | null {
	const splitWidth = getNodeWidthUnits(node);
	const deltaUnits = Math.max(splitWidth * step, 0.01);
	const minBranchWidth = Math.max(0.08, splitWidth * 0.08);
	const firstWidth = getBranchWidthUnits(node, "first");
	const secondWidth = getBranchWidthUnits(node, "second");

	let nextFirstWidth = firstWidth;
	let nextSecondWidth = secondWidth;

	if (branch === "first") {
		const requestedFirstWidth = direction === "right" ? firstWidth + deltaUnits : firstWidth - deltaUnits;
		nextFirstWidth = Math.max(minBranchWidth, requestedFirstWidth);
		if (direction === "right") {
			nextFirstWidth = Math.min(getResizeCap(), nextFirstWidth);
		}
	} else {
		const requestedSecondWidth = direction === "left" ? secondWidth + deltaUnits : secondWidth - deltaUnits;
		nextSecondWidth = Math.max(minBranchWidth, requestedSecondWidth);
		if (direction === "left") {
			nextSecondWidth = Math.min(getResizeCap(), nextSecondWidth);
		}
	}

	if (Math.abs(nextFirstWidth - firstWidth) < 1e-6 && Math.abs(nextSecondWidth - secondWidth) < 1e-6) return null;

	const nextWidthUnits = nextFirstWidth + nextSecondWidth;
	const nextRatio = nextFirstWidth / nextWidthUnits;
	const safeRatio = Math.min(0.999, Math.max(0.001, nextRatio));

	return {
		...node,
		ratio: safeRatio,
		widthUnits: nextWidthUnits,
		first: resizeLayoutWidth(node.first, nextFirstWidth),
		second: resizeLayoutWidth(node.second, nextSecondWidth),
	};
}

function rebuildPathAfterResize(path: PathEntry[], startIndex: number, updatedNode: LayoutNode): LayoutNode {
	let current = updatedNode;

	for (let i = startIndex - 1; i >= 0; i--) {
		const entry = path[i];
		if (entry.node.direction === "vertical") {
			if (entry.branch === "first") {
				const firstWidth = getNodeWidthUnits(current);
				const secondWidth = getBranchWidthUnits(entry.node, "second");
				const widthUnits = firstWidth + secondWidth;
				const ratio = firstWidth / widthUnits;
				const safeRatio = Math.min(0.999, Math.max(0.001, ratio));
				current = {
					...entry.node,
					ratio: safeRatio,
					widthUnits,
					first: resizeLayoutWidth(current, firstWidth),
					second: resizeLayoutWidth(entry.node.second, secondWidth),
				};
			} else {
				const firstWidth = getBranchWidthUnits(entry.node, "first");
				const secondWidth = getNodeWidthUnits(current);
				const widthUnits = firstWidth + secondWidth;
				const ratio = firstWidth / widthUnits;
				const safeRatio = Math.min(0.999, Math.max(0.001, ratio));
				current = {
					...entry.node,
					ratio: safeRatio,
					widthUnits,
					first: resizeLayoutWidth(entry.node.first, firstWidth),
					second: resizeLayoutWidth(current, secondWidth),
				};
			}
			continue;
		}

		const nextWidth = getNodeWidthUnits(current);
		current = {
			...entry.node,
			widthUnits: nextWidth,
			first: resizeLayoutWidth(entry.branch === "first" ? current : entry.node.first, nextWidth),
			second: resizeLayoutWidth(entry.branch === "second" ? current : entry.node.second, nextWidth),
		};
	}

	return current;
}

function findSplitPath(root: LayoutNode, splitId: string): PathEntry[] | null {
	if (root.type === "pane") return null;
	if (root.id === splitId) return [];

	const firstPath = findSplitPath(root.first, splitId);
	if (firstPath !== null) return [{ node: root, branch: "first" }, ...firstPath];

	const secondPath = findSplitPath(root.second, splitId);
	if (secondPath !== null) return [{ node: root, branch: "second" }, ...secondPath];

	return null;
}

function findSplitById(root: LayoutNode, splitId: string): SplitLayoutNode | null {
	if (root.type === "pane") return null;
	if (root.id === splitId) return root;
	return findSplitById(root.first, splitId) ?? findSplitById(root.second, splitId);
}

function resizeVerticalSplitKeepSecondWidth(node: SplitLayoutNode, deltaRatio: number): LayoutNode | null {
	if (node.direction !== "vertical") return null;
	const splitWidth = getNodeWidthUnits(node);
	const deltaUnits = splitWidth * deltaRatio;
	if (Math.abs(deltaUnits) < 1e-5) return null;

	const firstWidth = getBranchWidthUnits(node, "first");
	const secondWidth = getBranchWidthUnits(node, "second");
	const minBranchWidth = Math.max(0.08, splitWidth * 0.08);
	const requestedFirstWidth = Math.max(minBranchWidth, firstWidth + deltaUnits);
	const nextFirstWidth = deltaUnits > 0
		? Math.min(getResizeCap(), requestedFirstWidth)
		: requestedFirstWidth;
	if (Math.abs(nextFirstWidth - firstWidth) < 1e-6) return null;

	const nextWidthUnits = nextFirstWidth + secondWidth;
	const nextRatio = nextFirstWidth / nextWidthUnits;
	const safeRatio = Math.min(0.999, Math.max(0.001, nextRatio));

	return {
		...node,
		ratio: safeRatio,
		widthUnits: nextWidthUnits,
		first: resizeLayoutWidth(node.first, nextFirstWidth),
		second: resizeLayoutWidth(node.second, secondWidth),
	};
}

function resizeVerticalSplitKeepFirstWidth(node: SplitLayoutNode, deltaRatio: number): LayoutNode | null {
	if (node.direction !== "vertical") return null;
	const splitWidth = getNodeWidthUnits(node);
	const deltaUnits = splitWidth * deltaRatio;
	if (Math.abs(deltaUnits) < 1e-5) return null;

	const firstWidth = getBranchWidthUnits(node, "first");
	const secondWidth = getBranchWidthUnits(node, "second");
	const minBranchWidth = Math.max(0.08, splitWidth * 0.08);
	const requestedSecondWidth = Math.max(minBranchWidth, secondWidth + deltaUnits);
	const nextSecondWidth = deltaUnits > 0
		? Math.min(getResizeCap(), requestedSecondWidth)
		: requestedSecondWidth;
	if (Math.abs(nextSecondWidth - secondWidth) < 1e-6) return null;

	const nextWidthUnits = firstWidth + nextSecondWidth;
	const nextRatio = firstWidth / nextWidthUnits;
	const safeRatio = Math.min(0.999, Math.max(0.001, nextRatio));

	return {
		...node,
		ratio: safeRatio,
		widthUnits: nextWidthUnits,
		first: resizeLayoutWidth(node.first, firstWidth),
		second: resizeLayoutWidth(node.second, nextSecondWidth),
	};
}

export function resizeVerticalSplitByDelta(
	root: LayoutNode,
	splitId: string,
	deltaRatio: number,
	branch: "first" | "second" = "first",
): LayoutNode {
	const path = findSplitPath(root, splitId);
	if (path === null) return root;
	const target = findSplitById(root, splitId);
	if (!target) return root;

	const resizedTarget = branch === "first"
		? resizeVerticalSplitKeepSecondWidth(target, deltaRatio)
		: resizeVerticalSplitKeepFirstWidth(target, deltaRatio);
	if (!resizedTarget) return root;

	return rebuildPathAfterResize(path, path.length, resizedTarget);
}

export function resizeFromPane(root: LayoutNode, paneId: string, direction: FocusDirection, step: number): LayoutNode {
	const path = findPath(root, paneId);
	if (!path) return root;

	if (direction === "left" || direction === "right") {
		for (let i = path.length - 1; i >= 0; i--) {
			const entry = path[i];
			if (entry.node.direction !== "vertical") continue;
			if (direction === "right" && entry.branch !== "first") continue;
			if (direction === "left" && entry.branch !== "second") continue;
			const resizedNode = resizeVerticalSplitPreserveSibling(entry.node, entry.branch, direction, step);
			if (!resizedNode) return root;
			return rebuildPathAfterResize(path, i, resizedNode);
		}
		return root;
	}

	for (let i = path.length - 1; i >= 0; i--) {
		const entry = path[i];
		if (entry.node.direction !== "horizontal") continue;
		if (direction === "down" && entry.branch !== "first") continue;
		if (direction === "up" && entry.branch !== "second") continue;

		const delta = entry.branch === "first"
			? (direction === "down" ? step : -step)
			: (direction === "up" ? -step : step);

		return updateSplitRatio(root, entry.node.id, entry.node.ratio + delta);
	}

	return root;
}

function capSinglePaneWidthUnits(node: LayoutNode): LayoutNode {
	if (node.type === "pane") {
		return {
			...node,
			widthUnits: Math.min(getNodeWidthUnits(node), MAX_BRANCH_EXPAND_UNITS),
		};
	}

	if (node.direction === "horizontal") {
		const cappedWidthUnits = Math.min(getNodeWidthUnits(node), MAX_BRANCH_EXPAND_UNITS);
		const nextRatio = clampRatio(node.ratio ?? 0.5);
		const nextFirst = capSinglePaneWidthUnits(node.first);
		const nextSecond = capSinglePaneWidthUnits(node.second);
		return {
			...node,
			ratio: nextRatio,
			widthUnits: cappedWidthUnits,
			first: resizeLayoutWidth(nextFirst, cappedWidthUnits),
			second: resizeLayoutWidth(nextSecond, cappedWidthUnits),
		};
	}

	const nextFirst = capSinglePaneWidthUnits(node.first);
	const nextSecond = capSinglePaneWidthUnits(node.second);
	const firstWidthUnits = getNodeWidthUnits(nextFirst);
	const secondWidthUnits = getNodeWidthUnits(nextSecond);
	const totalWidthUnits = firstWidthUnits + secondWidthUnits;
	const safeRatio = clampRatio(firstWidthUnits / Math.max(totalWidthUnits, 0.01));
	return {
		...node,
		ratio: safeRatio,
		widthUnits: totalWidthUnits,
		first: resizeLayoutWidth(nextFirst, firstWidthUnits),
		second: resizeLayoutWidth(nextSecond, secondWidthUnits),
	};
}

export function enforcePaneWidthCap(node: LayoutNode): LayoutNode {
	return capSinglePaneWidthUnits(node);
}

function rehydrateTab(rawTab: unknown, workspacePath: string): PaneTabModel {
	if (!rawTab || typeof rawTab !== "object") return createTerminalTab(workspacePath);
	const tab = rawTab as Partial<PaneTabModel> & { kind?: string };

	if (!tab.kind || tab.kind === "terminal") {
		const title = typeof tab.title === "string" && tab.title.trim().length > 0 ? tab.title : "terminal";
		return {
			id: typeof tab.id === "string" ? tab.id : crypto.randomUUID(),
			kind: "terminal",
			title,
			status: "starting" as PaneStatus,
			shellLabel: undefined,
			message: "Launching terminal...",
		};
	}

	if (tab.kind === "fileTree") {
		return {
			...(createFileTreeTab(workspacePath)),
			id: typeof tab.id === "string" ? tab.id : crypto.randomUUID(),
			title: typeof tab.title === "string" ? tab.title : "Files",
			rootPath: typeof (tab as { rootPath?: string }).rootPath === "string" ? (tab as { rootPath: string }).rootPath : workspacePath,
		};
	}

	if (tab.kind === "editor") {
		const filePath = typeof (tab as { filePath?: string }).filePath === "string" ? (tab as { filePath: string }).filePath : "";
		const content = typeof (tab as { content?: string }).content === "string" ? (tab as { content: string }).content : "";
		const savedContent = typeof (tab as { savedContent?: string }).savedContent === "string"
			? (tab as { savedContent: string }).savedContent
			: content;
		return {
			...createEditorTab(filePath, content),
			id: typeof tab.id === "string" ? tab.id : crypto.randomUUID(),
			title: typeof tab.title === "string" ? tab.title : createEditorTab(filePath, content).title,
			language: typeof (tab as { language?: string }).language === "string" ? (tab as { language: string }).language : getMonacoLanguage(filePath),
			savedContent,
			dirty: typeof (tab as { dirty?: boolean }).dirty === "boolean" ? (tab as { dirty: boolean }).dirty : content !== savedContent,
			message: typeof (tab as { message?: string }).message === "string" ? (tab as { message: string }).message : undefined,
		};
	}

	if (tab.kind === "markdown") {
		const filePath = typeof (tab as { filePath?: string }).filePath === "string" ? (tab as { filePath: string }).filePath : "";
		const content = typeof (tab as { content?: string }).content === "string" ? (tab as { content: string }).content : "";
		const savedContent = typeof (tab as { savedContent?: string }).savedContent === "string"
			? (tab as { savedContent: string }).savedContent
			: content;
		return {
			...createMarkdownTab(filePath, content),
			id: typeof tab.id === "string" ? tab.id : crypto.randomUUID(),
			title: typeof tab.title === "string" ? tab.title : createMarkdownTab(filePath, content).title,
			savedContent,
			dirty: typeof (tab as { dirty?: boolean }).dirty === "boolean" ? (tab as { dirty: boolean }).dirty : content !== savedContent,
			message: typeof (tab as { message?: string }).message === "string" ? (tab as { message: string }).message : undefined,
		};
	}

	if (tab.kind === "image") {
		const filePath = typeof (tab as { filePath?: string }).filePath === "string" ? (tab as { filePath: string }).filePath : "";
		return {
			...createImageTab(filePath),
			id: typeof tab.id === "string" ? tab.id : crypto.randomUUID(),
			title: typeof tab.title === "string" ? tab.title : createImageTab(filePath).title,
		};
	}

	if (tab.kind === "pdf") {
		const filePath = typeof (tab as { filePath?: string }).filePath === "string" ? (tab as { filePath: string }).filePath : "";
		return {
			...createPdfTab(filePath),
			id: typeof tab.id === "string" ? tab.id : crypto.randomUUID(),
			title: typeof tab.title === "string" ? tab.title : createPdfTab(filePath).title,
		};
	}

	if (tab.kind === "browser") {
		const url = typeof (tab as { url?: string }).url === "string" && (tab as { url: string }).url.trim().length > 0
			? (tab as { url: string }).url
			: "about:blank";
		return {
			...createBrowserTab(url),
			id: typeof tab.id === "string" ? tab.id : crypto.randomUUID(),
			title: typeof tab.title === "string" && tab.title.trim().length > 0 ? tab.title : "Browser",
			url,
		};
	}

	return createTerminalTab(workspacePath);
}

export function rehydrateLayout(
	node: LayoutNode | undefined,
	workspacePath: string,
	inheritedWidthUnits = DEFAULT_WIDTH_UNITS,
	isRoot = true,
): LayoutNode {
	const hydrated = (() => {
		if (!node) return createPaneNode(workspacePath, createPaneModel(workspacePath), inheritedWidthUnits);

		if (node.type === "pane") {
			const tabs = node.pane.tabs?.length ? node.pane.tabs.map((tab) => rehydrateTab(tab, workspacePath)) : [createTerminalTab(workspacePath)];

			return {
				...node,
				widthUnits: clampWidthUnits(node.widthUnits ?? inheritedWidthUnits),
				pane: {
					...node.pane,
					tabs,
					activeTabId: tabs.some((tab) => tab.id === node.pane.activeTabId) ? node.pane.activeTabId : tabs[0].id,
				},
			};
		}

		const ratio = clampRatio(node.ratio ?? 0.5);
		const widthUnits = clampWidthUnits(node.widthUnits ?? inheritedWidthUnits);

		return {
			...node,
			ratio,
			widthUnits,
			first: rehydrateLayout(node.first, workspacePath, getBranchWidthUnits({ ...node, ratio, widthUnits }, "first"), false),
			second: rehydrateLayout(node.second, workspacePath, getBranchWidthUnits({ ...node, ratio, widthUnits }, "second"), false),
		};
	})();

	return isRoot ? enforcePaneWidthCap(hydrated) : hydrated;
}
