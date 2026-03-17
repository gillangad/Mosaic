import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceGitStatus } from "../core/models";

interface SidebarGitFileEntry {
	path: string;
	originalPath: string | null;
	status: string;
	staged: boolean;
	unstaged: boolean;
	raw: string;
}

interface SidebarGitStatusDetails extends WorkspaceGitStatus {
	files: SidebarGitFileEntry[];
}

interface SidebarGitBranchEntry {
	name: string;
	current: boolean;
}

interface SidebarGitCommitEntry {
	hash: string;
	shortHash: string;
	author: string;
	relativeTime: string;
	subject: string;
}

interface SidebarGitStashEntry {
	ref: string;
	message: string;
	relativeTime: string;
}

interface GitSidebarProps {
	workspacePath: string;
	git: WorkspaceGitStatus;
	onRefresh?: () => Promise<void> | void;
}

function toDetails(git: WorkspaceGitStatus): SidebarGitStatusDetails {
	return {
		...git,
		files: [],
	};
}

export function GitSidebar({ workspacePath, git, onRefresh }: GitSidebarProps) {
	const [status, setStatus] = useState<SidebarGitStatusDetails>(() => toDetails(git));
	const [branches, setBranches] = useState<SidebarGitBranchEntry[]>([]);
	const [commits, setCommits] = useState<SidebarGitCommitEntry[]>([]);
	const [stashes, setStashes] = useState<SidebarGitStashEntry[]>([]);
	const [expandedFilePath, setExpandedFilePath] = useState<string | null>(null);
	const [expandedCommitHash, setExpandedCommitHash] = useState<string | null>(null);
	const [fileDiff, setFileDiff] = useState<string>("");
	const [commitDiff, setCommitDiff] = useState<string>("");
	const [commitMessage, setCommitMessage] = useState("");
	const [amendCommit, setAmendCommit] = useState(false);
	const [stashOpen, setStashOpen] = useState(false);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const commitInputRef = useRef<HTMLInputElement | null>(null);

	const refreshWorkspaceBadge = useCallback(() => {
		if (!onRefresh) return;
		void Promise.resolve(onRefresh());
	}, [onRefresh]);

	const loadStatus = useCallback(
		async (force = false) => {
			const nextStatus = await window.mosaic.gitStatus(workspacePath, force);
			setStatus(nextStatus);
			refreshWorkspaceBadge();
			return nextStatus;
		},
		[refreshWorkspaceBadge, workspacePath],
	);

	const loadSidebarData = useCallback(async () => {
		setRefreshing(true);
		setError(null);
		try {
			const nextStatus = await window.mosaic.gitStatus(workspacePath, true);
			setStatus(nextStatus);
			if (!nextStatus.isRepo) {
				setBranches([]);
				setCommits([]);
				setStashes([]);
				refreshWorkspaceBadge();
				return;
			}

			const [nextBranches, nextCommits, nextStashes] = await Promise.all([
				window.mosaic.gitBranches(workspacePath),
				window.mosaic.gitLog(workspacePath, 40),
				window.mosaic.gitStashList(workspacePath),
			]);
			setBranches(nextBranches);
			setCommits(nextCommits);
			setStashes(nextStashes);
			refreshWorkspaceBadge();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setRefreshing(false);
		}
	}, [refreshWorkspaceBadge, workspacePath]);

	useEffect(() => {
		setStatus(toDetails(git));
		setExpandedFilePath(null);
		setExpandedCommitHash(null);
		setFileDiff("");
		setCommitDiff("");
		setCommitMessage("");
		setAmendCommit(false);
		setError(null);
		void loadSidebarData();
	}, [git, loadSidebarData, workspacePath]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			void loadStatus(false).catch(() => {
				// Silent poll failures are surfaced on next interactive action.
			});
		}, 3_000);
		return () => window.clearInterval(timer);
	}, [loadStatus]);

	const runAction = useCallback(async (label: string, action: () => Promise<void>) => {
		if (busyAction) return;
		setBusyAction(label);
		setError(null);
		try {
			await action();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusyAction(null);
		}
	}, [busyAction]);

	const activeBranch = useMemo(() => branches.find((branch) => branch.current)?.name ?? status.branch ?? "detached", [branches, status.branch]);
	const hasRepo = status.isRepo;

	const handleStageAll = useCallback(() => {
		void runAction("stage-all", async () => {
			await window.mosaic.gitStage(workspacePath, ".");
			await loadStatus(true);
		});
	}, [loadStatus, runAction, workspacePath]);

	const handleUnstageAll = useCallback(() => {
		void runAction("unstage-all", async () => {
			await window.mosaic.gitUnstage(workspacePath, ".");
			await loadStatus(true);
		});
	}, [loadStatus, runAction, workspacePath]);

	const handlePush = useCallback(() => {
		void runAction("push", async () => {
			await window.mosaic.gitPush(workspacePath);
			await loadSidebarData();
		});
	}, [loadSidebarData, runAction, workspacePath]);

	return (
		<div
			className="git-pane-surface workspace-git-surface tw-flex tw-h-full tw-min-h-0 tw-flex-col"
			tabIndex={0}
			onKeyDown={(event) => {
				if (!hasRepo) return;
				const target = event.target as HTMLElement | null;
				const isEditableTarget =
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement ||
					target?.isContentEditable;
				if (isEditableTarget) return;
				if (event.key.toLowerCase() === "s") {
					event.preventDefault();
					handleStageAll();
				}
				if (event.key.toLowerCase() === "c") {
					event.preventDefault();
					commitInputRef.current?.focus();
				}
				if (event.key.toLowerCase() === "p") {
					event.preventDefault();
					handlePush();
				}
			}}
		>
			<div className="file-tree-toolbar tw-flex tw-items-center tw-gap-2">
				<div className="file-tree-search tw-flex tw-min-w-0 tw-flex-1 tw-items-center">
					<span className="git-pane-title">Git</span>
				</div>
				<button
					type="button"
					className="file-tree-refresh"
					onClick={() => {
						if (refreshing) return;
						void loadSidebarData();
					}}
					disabled={refreshing}
					aria-label="Refresh git status"
				>
					{refreshing ? "…" : "↻"}
				</button>
			</div>

			<div className="git-pane-scroll tw-min-h-0 tw-flex-1 tw-overflow-auto">
				<div className="git-pane-section">
					<div className="git-pane-label">Workspace</div>
					<div className="git-pane-value" title={workspacePath}>{workspacePath}</div>
				</div>

				{!hasRepo ? (
					<div className="git-pane-section">
						<div className="git-pane-label">Repository</div>
						<div className="git-pane-value">No git repository detected.</div>
					</div>
				) : (
					<>
						<div className="git-pane-section git-pane-branch-bar">
							<div className="git-pane-row">
								<select
									className="git-pane-select"
									value={activeBranch}
									onChange={(event) => {
										const branch = event.target.value;
										void runAction("checkout", async () => {
											await window.mosaic.gitCheckout(workspacePath, branch);
											await loadSidebarData();
										});
									}}
								>
									{branches.map((branch) => (
										<option key={branch.name} value={branch.name}>{branch.name}</option>
									))}
								</select>
								<div className="git-pane-badges">
									<span className="git-pane-badge">+{status.ahead}</span>
									<span className="git-pane-badge">-{status.behind}</span>
								</div>
							</div>
							<div className="git-pane-row git-pane-actions-row">
								<button
									type="button"
									className="git-pane-action"
									onClick={() => {
										void runAction("pull", async () => {
											await window.mosaic.gitPull(workspacePath);
											await loadSidebarData();
										});
									}}
									disabled={busyAction !== null}
								>
									Pull
								</button>
								<button type="button" className="git-pane-action" onClick={handlePush} disabled={busyAction !== null}>
									Push
								</button>
							</div>
						</div>

						<div className="git-pane-section">
							<div className="git-pane-row git-pane-row-between">
								<div className="git-pane-label">Changed files</div>
								<div className="git-pane-tools">
									<button type="button" className="git-pane-action" onClick={handleStageAll} disabled={busyAction !== null || status.files.length === 0}>
										Stage all
									</button>
									<button type="button" className="git-pane-action" onClick={handleUnstageAll} disabled={busyAction !== null || status.files.length === 0}>
										Unstage all
									</button>
								</div>
							</div>
							{status.files.length === 0 ? <div className="git-pane-value">Working tree clean.</div> : null}
							<div className="git-file-list">
								{status.files.map((file) => {
									const selected = expandedFilePath === file.path;
									return (
										<div key={file.raw} className="git-file-item-wrap">
											<div className={`git-file-item ${selected ? "active" : ""}`}>
												<input
													type="checkbox"
													checked={file.staged && !file.unstaged}
													onChange={(event) => {
														const shouldStage = event.currentTarget.checked;
														void runAction("stage", async () => {
															if (shouldStage) {
																await window.mosaic.gitStage(workspacePath, file.path);
															} else {
																await window.mosaic.gitUnstage(workspacePath, file.path);
															}
															await loadStatus(true);
														});
													}}
												/>
												<button
													type="button"
													className="git-file-main"
													onClick={() => {
														if (selected) {
															setExpandedFilePath(null);
															setFileDiff("");
															return;
														}
														setExpandedFilePath(file.path);
														setFileDiff("Loading diff…");
														void window.mosaic.gitDiff(workspacePath, file.path, false)
															.then((diff) => (diff.trim().length > 0 ? diff : window.mosaic.gitDiff(workspacePath, file.path, true)))
															.then((diff) => setFileDiff(diff.trim().length > 0 ? diff : "No diff output."))
															.catch((err) => setFileDiff(err instanceof Error ? err.message : String(err)));
													}}
												>
													<span className="git-file-status">{file.status}</span>
													<span className="git-file-path" title={file.path}>{file.path}</span>
												</button>
											</div>
											{selected ? <pre className="git-pane-diff">{fileDiff}</pre> : null}
										</div>
									);
								})}
							</div>
						</div>

						<div className="git-pane-section">
							<div className="git-pane-label">Commit</div>
							<div className="git-pane-commit-row">
								<input
									ref={commitInputRef}
									type="text"
									value={commitMessage}
									onChange={(event) => setCommitMessage(event.target.value)}
									placeholder="Commit message"
									className="git-pane-input"
								/>
								<button
									type="button"
									className="git-pane-action"
									onClick={() => {
										void runAction("commit", async () => {
											await window.mosaic.gitCommit(workspacePath, commitMessage, amendCommit);
											setCommitMessage("");
											await loadSidebarData();
										});
									}}
									disabled={busyAction !== null || (!amendCommit && commitMessage.trim().length === 0)}
								>
									Commit
								</button>
							</div>
							<label className="git-pane-amend">
								<input type="checkbox" checked={amendCommit} onChange={(event) => setAmendCommit(event.target.checked)} />
								Amend
							</label>
						</div>

						<div className="git-pane-section">
							<div className="git-pane-label">Commit log</div>
							<div className="git-commit-list">
								{commits.map((commit) => {
									const selected = expandedCommitHash === commit.hash;
									return (
										<div key={commit.hash} className="git-commit-item-wrap">
											<button
												type="button"
												className={`git-commit-item ${selected ? "active" : ""}`}
												onClick={() => {
													if (selected) {
														setExpandedCommitHash(null);
														setCommitDiff("");
														return;
													}
													setExpandedCommitHash(commit.hash);
													setCommitDiff("Loading commit diff…");
													void window.mosaic.gitShowCommit(workspacePath, commit.hash)
														.then((diff) => setCommitDiff(diff.trim().length > 0 ? diff : "No diff output."))
														.catch((err) => setCommitDiff(err instanceof Error ? err.message : String(err)));
												}}
											>
												<div className="git-commit-main">
													<span className="git-commit-subject">{commit.subject}</span>
													<span className="git-commit-meta">{commit.shortHash} · {commit.author} · {commit.relativeTime}</span>
												</div>
											</button>
											{selected ? <pre className="git-pane-diff">{commitDiff}</pre> : null}
										</div>
									);
								})}
							</div>
						</div>

						<div className="git-pane-section">
							<button type="button" className="git-pane-collapse" onClick={() => setStashOpen((current) => !current)}>
								<span>Stashes</span>
								<span>{stashOpen ? "▾" : "▸"}</span>
							</button>
							{stashOpen ? (
								<div className="git-stash-list">
									{stashes.length === 0 ? <div className="git-pane-value">No stashes.</div> : null}
									{stashes.map((stash) => (
										<div key={stash.ref} className="git-stash-item">
											<div className="git-stash-copy">
												<div className="git-stash-ref">{stash.ref}</div>
												<div className="git-stash-meta">{stash.message} · {stash.relativeTime}</div>
											</div>
											<div className="git-stash-actions">
												<button
													type="button"
													className="git-pane-action"
													onClick={() => {
														void runAction("stash-apply", async () => {
															await window.mosaic.gitStashApply(workspacePath, stash.ref);
															await loadSidebarData();
														});
													}}
													disabled={busyAction !== null}
												>
													Apply
												</button>
												<button
													type="button"
													className="git-pane-action danger"
													onClick={() => {
														void runAction("stash-drop", async () => {
															await window.mosaic.gitStashDrop(workspacePath, stash.ref);
															await loadSidebarData();
														});
													}}
													disabled={busyAction !== null}
												>
													Drop
												</button>
											</div>
										</div>
									))}
								</div>
							) : null}
						</div>
					</>
				)}

				{hasRepo ? <div className="git-pane-shortcuts">Shortcuts: S stage all · C focus commit · P push</div> : null}
				{error ? <div className="git-pane-error">{error}</div> : null}
			</div>
		</div>
	);
}
