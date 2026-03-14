import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { motion } from "framer-motion";
import { TerminalPane } from "./components/TerminalPane";
import {
	addTabToPane,
	appendPaneToRight,
	closeTab,
	countPanes,
	getLayoutWidthUnits,
	removePane,
	setActiveTab,
	splitNode,
	updateSplitRatio,
	updateTabMeta,
} from "./core/layout";
import type { LayoutNode, SplitDirection, TerminalTabModel, WorkspaceModel } from "./core/models";
import type { MosaicTheme } from "./core/themes";

interface LayoutViewProps {
	node: LayoutNode;
	accent: string;
	theme: MosaicTheme;
	cwd: string;
	focusedPaneId?: string;
	onFocusPane: (paneId: string) => void;
	onSplit: (paneId: string, direction: SplitDirection) => void;
	onClosePane: (paneId: string) => void;
	onAddTab: (paneId: string) => void;
	onSelectTab: (paneId: string, tabId: string) => void;
	onCloseTab: (paneId: string, tabId: string) => void;
	onResize: (splitId: string, ratio: number) => void;
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
	onFocusPane,
	onSplit,
	onClosePane,
	onAddTab,
	onSelectTab,
	onCloseTab,
	onResize,
	onUpdateTabMeta,
}: LayoutViewProps) {
	if (node.type === "pane") {
		return (
			<div className="layout-leaf" key={node.pane.id}>
				<TerminalPane
					pane={node.pane}
					accent={accent}
					theme={theme}
					cwd={cwd}
					focused={focusedPaneId === node.pane.id}
					onFocus={() => onFocusPane(node.pane.id)}
					onSplitVertical={() => onSplit(node.pane.id, "vertical")}
					onSplitHorizontal={() => onSplit(node.pane.id, "horizontal")}
					onClose={() => onClosePane(node.pane.id)}
					onAddTab={() => onAddTab(node.pane.id)}
					onSelectTab={(tabId) => onSelectTab(node.pane.id, tabId)}
					onCloseTab={(tabId) => onCloseTab(node.pane.id, tabId)}
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
					onFocusPane={onFocusPane}
					onSplit={onSplit}
					onClosePane={onClosePane}
					onAddTab={onAddTab}
					onSelectTab={onSelectTab}
					onCloseTab={onCloseTab}
					onResize={onResize}
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
					onFocusPane={onFocusPane}
					onSplit={onSplit}
					onClosePane={onClosePane}
					onAddTab={onAddTab}
					onSelectTab={onSelectTab}
					onCloseTab={onCloseTab}
					onResize={onResize}
					onUpdateTabMeta={onUpdateTabMeta}
				/>
			</div>
		</div>
	);
}

interface WorkspaceViewProps {
	workspace: WorkspaceModel;
	accent: string;
	theme: MosaicTheme;
	focusedPaneId?: string;
	onFocusPane: (paneId: string) => void;
	onUpdateLayout: (layout: LayoutNode) => void;
}

export function WorkspaceView({ workspace, accent, theme, focusedPaneId, onFocusPane, onUpdateLayout }: WorkspaceViewProps) {
	const layoutRootRef = useRef<HTMLDivElement | null>(null);
	const previousPaneCountRef = useRef(countPanes(workspace.layout));
	const shouldRevealNewestPaneRef = useRef(false);

	useEffect(() => {
		const nextCount = countPanes(workspace.layout);
		if (nextCount > previousPaneCountRef.current && shouldRevealNewestPaneRef.current && layoutRootRef.current) {
			layoutRootRef.current.scrollTo({
				left: layoutRootRef.current.scrollWidth,
				behavior: "smooth",
			});
		}
		shouldRevealNewestPaneRef.current = false;
		previousPaneCountRef.current = nextCount;
	}, [workspace.layout]);

	return (
		<div className="workspace-root">
			<div className="workspace-subheader">
				<div className="workspace-subheader-spacer" />
				<motion.button
					whileHover={{ scale: 1.05 }}
					whileTap={{ scale: 0.95 }}
					onClick={() => {
						shouldRevealNewestPaneRef.current = true;
						onUpdateLayout(appendPaneToRight(workspace.layout, workspace.path));
					}}
					className="new-pane-button"
					style={{ ["--workspace-accent" as string]: accent }}
				>
					<span className="new-pane-plus">+</span> New Pane
				</motion.button>
			</div>

			<div ref={layoutRootRef} className="layout-root">
				<div className="layout-canvas" style={{ width: `${Math.max(getLayoutWidthUnits(workspace.layout), 1) * 100}%`, minWidth: "100%" }}>
					<LayoutView
						node={workspace.layout}
						accent={accent}
						theme={theme}
						cwd={workspace.path}
						focusedPaneId={focusedPaneId}
						onFocusPane={onFocusPane}
						onSplit={(paneId, direction) => {
							shouldRevealNewestPaneRef.current = false;
							onUpdateLayout(splitNode(workspace.layout, paneId, direction, workspace.path));
						}}
						onClosePane={(paneId) => onUpdateLayout(removePane(workspace.layout, paneId) ?? workspace.layout)}
						onAddTab={(paneId) => onUpdateLayout(addTabToPane(workspace.layout, paneId, workspace.path))}
						onSelectTab={(paneId, tabId) => onUpdateLayout(setActiveTab(workspace.layout, paneId, tabId))}
						onCloseTab={(paneId, tabId) => onUpdateLayout(closeTab(workspace.layout, paneId, tabId, workspace.path))}
						onResize={(splitId, ratio) => onUpdateLayout(updateSplitRatio(workspace.layout, splitId, ratio))}
						onUpdateTabMeta={(paneId, tabId, patch) => onUpdateLayout(updateTabMeta(workspace.layout, paneId, tabId, patch))}
					/>
				</div>
			</div>
		</div>
	);
}
