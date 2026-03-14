import type { LayoutNode, PaneLayoutNode, PaneModel, PaneStatus, SplitDirection, SplitLayoutNode, TerminalTabModel } from "./models";
import { getWorkspaceLeafName } from "./workspaces";

export type FocusDirection = "left" | "right" | "up" | "down";

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

export function setActiveTab(node: LayoutNode, paneId: string, tabId: string): LayoutNode {
	return mapPane(node, paneId, (pane) => ({
		...pane,
		activeTabId: tabId,
	}));
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

export function resizeFromPane(root: LayoutNode, paneId: string, direction: FocusDirection, step: number): LayoutNode {
	const path = findPath(root, paneId);
	if (!path) return root;

	const splitDir: SplitDirection = direction === "left" || direction === "right" ? "vertical" : "horizontal";

	for (let i = path.length - 1; i >= 0; i--) {
		const entry = path[i];
		if (entry.node.direction !== splitDir) continue;

		const delta = entry.branch === "first"
			? (direction === "right" || direction === "down" ? step : -step)
			: (direction === "left" || direction === "up" ? -step : step);

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
