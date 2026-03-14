import type { WorkspaceModel } from "./models";

function splitPathSegments(value: string) {
	return value.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
}

export function getWorkspaceDisplayName(workspace: Pick<WorkspaceModel, "path" | "customName">) {
	if (workspace.customName?.trim()) return workspace.customName.trim();

	const normalizedPath = workspace.path.replace(/[\\/]+$/, "");
	const segments = splitPathSegments(normalizedPath);
	const current = segments.at(-1) || normalizedPath;
	const parent = segments.at(-2);

	return parent ? `${parent}/${current}` : current;
}

export function getWorkspaceLeafName(workspacePath: string) {
	const segments = splitPathSegments(workspacePath);
	return segments.at(-1) || "shell";
}

export function getCompactPathLabel(workspacePath: string, segmentCount = 2) {
	const segments = splitPathSegments(workspacePath);
	if (segments.length <= segmentCount) return segments.join("/") || workspacePath;
	return `.../${segments.slice(-segmentCount).join("/")}`;
}

export function getWorkspaceTabLabel(workspace: Pick<WorkspaceModel, "path" | "customName">) {
	if (workspace.customName?.trim()) {
		const value = workspace.customName.trim();
		return value.length > 24 ? `${value.slice(0, 21)}...` : value;
	}

	return getCompactPathLabel(workspace.path, 2);
}

export function serializeWorkspaceState(workspaces: WorkspaceModel[]) {
	return workspaces.map(({ id, path, customName, layout, focusedPaneId }) => ({ id, path, customName, layout, focusedPaneId }));
}
