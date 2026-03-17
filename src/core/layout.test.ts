import { describe, expect, it } from "vitest";
import {
	appendPaneToRight,
	countPanes,
	createPaneNode,
	enforcePaneWidthCap,
	moveColumnContainingPane,
	movePaneToColumnIndex,
	resizeVerticalSplitByDelta,
	updateSplitRatio,
} from "./layout";
import type { LayoutNode, SplitLayoutNode } from "./models";

const WORKSPACE_PATH = "/tmp/mosaic-test";

function listPaneOrder(node: LayoutNode): string[] {
	if (node.type === "pane") return [node.pane.id];
	return [...listPaneOrder(node.first), ...listPaneOrder(node.second)];
}

function findSplitById(node: LayoutNode, splitId: string): SplitLayoutNode | null {
	if (node.type === "pane") return null;
	if (node.id === splitId) return node;
	return findSplitById(node.first, splitId) ?? findSplitById(node.second, splitId);
}

function getVerticalBranchWidths(split: SplitLayoutNode) {
	expect(split.direction).toBe("vertical");
	const widthUnits = split.widthUnits ?? 100;
	const first = widthUnits * split.ratio;
	const second = widthUnits * (1 - split.ratio);
	return { first, second };
}

function createThreePaneLayout(): LayoutNode {
	let layout: LayoutNode = createPaneNode(WORKSPACE_PATH);
	layout = appendPaneToRight(layout, WORKSPACE_PATH);
	layout = appendPaneToRight(layout, WORKSPACE_PATH);
	return layout;
}

describe("layout column operations", () => {
	it("moves a column right by one step while keeping pane count", () => {
		const layout = createThreePaneLayout();
		const [firstPane, secondPane, thirdPane] = listPaneOrder(layout);

		const moved = moveColumnContainingPane(layout, firstPane, 1);
		expect(listPaneOrder(moved)).toEqual([secondPane, firstPane, thirdPane]);
		expect(countPanes(moved)).toBe(3);
	});

	it("inserts a moved pane at far-left column index", () => {
		const layout = createThreePaneLayout();
		const [firstPane, secondPane, thirdPane] = listPaneOrder(layout);

		const moved = movePaneToColumnIndex(layout, thirdPane, 0);
		expect(listPaneOrder(moved)).toEqual([thirdPane, firstPane, secondPane]);
		expect(countPanes(moved)).toBe(3);
	});
});

describe("layout resizing invariants", () => {
	it("resizeVerticalSplitByDelta keeps total width stable while moving divider", () => {
		const layout = appendPaneToRight(createPaneNode(WORKSPACE_PATH), WORKSPACE_PATH);
		expect(layout.type).toBe("split");
		if (layout.type !== "split" || layout.direction !== "vertical") return;

		const before = getVerticalBranchWidths(layout);
		const beforeTotal = before.first + before.second;
		const resized = resizeVerticalSplitByDelta(layout, layout.id, 0.16, "second");
		const split = findSplitById(resized, layout.id);
		expect(split).not.toBeNull();
		if (!split || split.direction !== "vertical") return;

		const after = getVerticalBranchWidths(split);
		const afterTotal = after.first + after.second;
		expect(afterTotal).toBeCloseTo(beforeTotal, 6);
		expect(after.first).toBeGreaterThan(before.first);
		expect(after.second).toBeLessThan(before.second);
	});

	it("resizeVerticalSplitByDelta respects branch cap at 200 width units", () => {
		const layout = appendPaneToRight(createPaneNode(WORKSPACE_PATH), WORKSPACE_PATH);
		expect(layout.type).toBe("split");
		if (layout.type !== "split" || layout.direction !== "vertical") return;

		const resized = resizeVerticalSplitByDelta(layout, layout.id, 5, "first");
		const split = findSplitById(resized, layout.id);
		expect(split).not.toBeNull();
		if (!split || split.direction !== "vertical") return;

		const after = getVerticalBranchWidths(split);
		expect(after.first).toBeLessThanOrEqual(200);
		expect(after.second).toBeGreaterThan(0);
	});

	it("updateSplitRatio preserves second branch width for vertical split", () => {
		const layout = appendPaneToRight(createPaneNode(WORKSPACE_PATH), WORKSPACE_PATH);
		expect(layout.type).toBe("split");
		if (layout.type !== "split" || layout.direction !== "vertical") return;

		const before = getVerticalBranchWidths(layout);
		const updated = updateSplitRatio(layout, layout.id, 0.4);
		const split = findSplitById(updated, layout.id);
		expect(split).not.toBeNull();
		if (!split || split.direction !== "vertical") return;

		const after = getVerticalBranchWidths(split);
		expect(after.second).toBeCloseTo(before.second, 6);
		expect(after.first).toBeCloseTo(60, 6);
	});

	it("updateSplitRatio allows first branch to grow past 100 width units", () => {
		const layout = appendPaneToRight(createPaneNode(WORKSPACE_PATH), WORKSPACE_PATH);
		expect(layout.type).toBe("split");
		if (layout.type !== "split" || layout.direction !== "vertical") return;

		const updated = updateSplitRatio(layout, layout.id, 3);
		const split = findSplitById(updated, layout.id);
		expect(split).not.toBeNull();
		if (!split || split.direction !== "vertical") return;

		const after = getVerticalBranchWidths(split);
		expect(after.first).toBeGreaterThan(100);
		expect(after.second).toBeGreaterThan(0);
	});

	it("enforcePaneWidthCap keeps pane widths below the expanded cap", () => {
		const oversized = createPaneNode(WORKSPACE_PATH);
		const layout: LayoutNode = {
			...oversized,
			widthUnits: 182,
		};

		const normalized = enforcePaneWidthCap(layout);
		expect(normalized.type).toBe("pane");
		if (normalized.type !== "pane") return;
		expect(normalized.widthUnits).toBeCloseTo(182, 6);
	});
});
