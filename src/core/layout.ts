import type { LayoutNode, PaneLayoutNode, PaneModel, PaneStatus, SplitDirection, SplitLayoutNode, TerminalTabModel } from "./models";
import { getWorkspaceLeafName } from "./workspaces";

export type FocusDirection = "left" | "right" | "up" | "down";
export type PaneDropPosition = "center" | "left" | "right" | "top" | "bottom";

type PathEntry = { node: SplitLayoutNode; branch: "first" | "second" };

const DEFAULT_WIDTH_UNITS = 1;
const APPENDED_PANE_WIDTH_UNITS = 0.5;

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

function createTerminalTab(workspacePath: string): TerminalTabModel {
	return {
		id: crypto.randomUUID(),
		title: getWorkspaceLeafName(workspacePath),
		status: "starting",
		message: "Launching terminal...",
	};
}

export function createPaneModel(workspacePath: string): PaneModel {
	const firstTab = createTerminalTab(workspacePath);
	return {
		id: crypto.randomUUID(),
		tabs: [firstTab],
		activeTabId: firstTab.id,
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
		const nextWidthUnits = isRoot ? Math.max(DEFAULT_WIDTH_UNITS, getNodeWidthUnits(second)) : getNodeWidthUnits(node);
		return resizeLayoutWidth(second, nextWidthUnits);
	}
	if (!second) {
		const nextWidthUnits = isRoot ? Math.max(DEFAULT_WIDTH_UNITS, getNodeWidthUnits(first)) : getNodeWidthUnits(node);
		return resizeLayoutWidth(first, nextWidthUnits);
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

export function updateTabMeta(
	node: LayoutNode,
	paneId: string,
	tabId: string,
	patch: Partial<Pick<TerminalTabModel, "status" | "shellLabel" | "message" | "title">>,
): LayoutNode {
	return mapPane(node, paneId, (pane) => ({
		...pane,
		tabs: pane.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
	}));
}

export function updateSplitRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
	if (node.type === "pane") return node;
	if (node.id === splitId) {
		const nextRatio = clampRatio(ratio);
		const widthUnits = getNodeWidthUnits(node);
		const firstWidthUnits = node.direction === "vertical" ? widthUnits * nextRatio : widthUnits;
		const secondWidthUnits = node.direction === "vertical" ? widthUnits * (1 - nextRatio) : widthUnits;

		return {
			...node,
			ratio: nextRatio,
			widthUnits,
			first: resizeLayoutWidth(node.first, firstWidthUnits),
			second: resizeLayoutWidth(node.second, secondWidthUnits),
		};
	}

	return {
		...node,
		widthUnits: getNodeWidthUnits(node),
		first: updateSplitRatio(node.first, splitId, ratio),
		second: updateSplitRatio(node.second, splitId, ratio),
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
		nextFirstWidth = direction === "right" ? firstWidth + deltaUnits : firstWidth - deltaUnits;
		nextFirstWidth = Math.max(minBranchWidth, nextFirstWidth);
	} else {
		nextSecondWidth = direction === "left" ? secondWidth + deltaUnits : secondWidth - deltaUnits;
		nextSecondWidth = Math.max(minBranchWidth, nextSecondWidth);
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
	const nextFirstWidth = Math.max(minBranchWidth, firstWidth + deltaUnits);
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

export function resizeVerticalSplitByDelta(root: LayoutNode, splitId: string, deltaRatio: number): LayoutNode {
	const path = findSplitPath(root, splitId);
	if (path === null) return root;
	const target = findSplitById(root, splitId);
	if (!target) return root;

	const resizedTarget = resizeVerticalSplitKeepSecondWidth(target, deltaRatio);
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

export function rehydrateLayout(
	node: LayoutNode | undefined,
	workspacePath: string,
	inheritedWidthUnits = DEFAULT_WIDTH_UNITS,
): LayoutNode {
	if (!node) return createPaneNode(workspacePath, createPaneModel(workspacePath), inheritedWidthUnits);

	if (node.type === "pane") {
		const tabs = node.pane.tabs?.length
			? node.pane.tabs.map((tab) => ({
					...tab,
					status: "starting" as PaneStatus,
					shellLabel: undefined,
					message: "Launching terminal...",
			  }))
			: [createTerminalTab(workspacePath)];

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
		first: rehydrateLayout(node.first, workspacePath, getBranchWidthUnits({ ...node, ratio, widthUnits }, "first")),
		second: rehydrateLayout(node.second, workspacePath, getBranchWidthUnits({ ...node, ratio, widthUnits }, "second")),
	};
}
