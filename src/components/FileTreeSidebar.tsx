import { useCallback, useEffect, useMemo, useState } from "react";

interface FileTreeSidebarProps {
	rootPath: string;
	onOpenFile: (filePath: string) => void;
}

interface FileTreeEntry {
	name: string;
	path: string;
	relativePath: string;
	isDirectory: boolean;
	extension: string;
}

function FileTypeIcon({ entry }: { entry: FileTreeEntry }) {
	if (entry.isDirectory) {
		return (
			<svg className="file-tree-icon-svg folder" viewBox="0 0 16 16" fill="none">
				<path d="M1.5 2.5h4.25l1.5 1.5h7.25v9.5h-13z" fill="currentColor" opacity="0.85" />
			</svg>
		);
	}
	const ext = entry.extension.toLowerCase();
	let colorClass = "default";
	if (["ts", "tsx"].includes(ext)) colorClass = "typescript";
	else if (["js", "jsx", "mjs", "cjs"].includes(ext)) colorClass = "javascript";
	else if (["json", "yaml", "yml", "toml", "ini"].includes(ext)) colorClass = "config";
	else if (["md", "markdown"].includes(ext)) colorClass = "markdown";
	else if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) colorClass = "image";
	else if (["css", "scss", "less"].includes(ext)) colorClass = "style";
	else if (["sh", "bash", "zsh", "ps1"].includes(ext)) colorClass = "shell";
	else if (["html", "htm"].includes(ext)) colorClass = "html";
	else if (["py"].includes(ext)) colorClass = "python";
	else if (["rs"].includes(ext)) colorClass = "rust";
	else if (["go"].includes(ext)) colorClass = "go";
	return (
		<svg className={`file-tree-icon-svg file-icon-${colorClass}`} viewBox="0 0 16 16" fill="none">
			<path d="M3 1.5h6.5l3 3V14.5H3z" stroke="currentColor" strokeWidth="1" fill="none" />
			<path d="M9.5 1.5v3h3" stroke="currentColor" strokeWidth="1" fill="none" />
		</svg>
	);
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
	return (
		<svg className={`file-tree-chevron ${expanded ? "expanded" : ""}`} viewBox="0 0 16 16" fill="none">
			<path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function FileTreeSidebar({ rootPath, onOpenFile }: FileTreeSidebarProps) {
	const [entriesByPath, setEntriesByPath] = useState<Record<string, FileTreeEntry[]>>({});
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([rootPath]));
	const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filterQuery, setFilterQuery] = useState("");

	useEffect(() => {
		setEntriesByPath({});
		setExpandedPaths(new Set([rootPath]));
		setLoadingPaths(new Set());
		setSelectedPath(null);
		setError(null);
		setFilterQuery("");
	}, [rootPath]);

	const loadDirectory = useCallback(
		async (directoryPath: string) => {
			if (typeof window === "undefined" || typeof window.mosaic === "undefined") return;
			setLoadingPaths((current) => {
				const next = new Set(current);
				next.add(directoryPath);
				return next;
			});
			setError(null);
			try {
				const entries = await window.mosaic.readDirectory(rootPath, directoryPath);
				setEntriesByPath((current) => ({ ...current, [directoryPath]: entries }));
			} catch (loadError) {
				setError(loadError instanceof Error ? loadError.message : "Unable to read directory.");
			} finally {
				setLoadingPaths((current) => {
					const next = new Set(current);
					next.delete(directoryPath);
					return next;
				});
			}
		},
		[rootPath],
	);

	useEffect(() => {
		void loadDirectory(rootPath);
	}, [loadDirectory, rootPath]);


	const toggleDirectory = useCallback(
		(entry: FileTreeEntry) => {
			if (!entry.isDirectory) return;
			setExpandedPaths((current) => {
				const next = new Set(current);
				if (next.has(entry.path)) {
					next.delete(entry.path);
					return next;
				}
				next.add(entry.path);
				return next;
			});
			if (!entriesByPath[entry.path]) {
				void loadDirectory(entry.path);
			}
		},
		[entriesByPath, loadDirectory],
	);

	const filterLower = filterQuery.toLowerCase();

	const matchesFilter = useCallback(
		(parentPath: string): boolean => {
			if (!filterLower) return true;
			const entries = entriesByPath[parentPath] ?? [];
			return entries.some((entry) => {
				if (entry.name.toLowerCase().includes(filterLower)) return true;
				if (entry.isDirectory && entriesByPath[entry.path]) return matchesFilter(entry.path);
				return false;
			});
		},
		[entriesByPath, filterLower],
	);

	const renderEntries = useCallback(
		(parentPath: string, depth: number) => {
			let entries = entriesByPath[parentPath] ?? [];
			if (filterLower) {
				entries = entries.filter((entry) => {
					if (entry.name.toLowerCase().includes(filterLower)) return true;
					if (entry.isDirectory && entriesByPath[entry.path]) return matchesFilter(entry.path);
					return false;
				});
			}
			if (entries.length === 0) return null;
			return (
				<ul className="file-tree-list" role={depth === 0 ? "tree" : "group"}>
					{entries.map((entry) => {
						const isExpanded = expandedPaths.has(entry.path) || (!!filterLower && entry.isDirectory);
						const isLoading = loadingPaths.has(entry.path);
						const childCount = entriesByPath[entry.path]?.length;
						return (
							<li key={entry.path} className="file-tree-item" style={{ ["--tree-depth" as string]: String(depth) }}>
								<button
									type="button"
									className={`file-tree-row ${entry.isDirectory ? "directory" : "file"} ${selectedPath === entry.path ? "selected" : ""}`}
									onClick={() => {
										if (entry.isDirectory) {
											toggleDirectory(entry);
											return;
										}
										setSelectedPath(entry.path);
										onOpenFile(entry.path);
									}}
									role="treeitem"
									aria-expanded={entry.isDirectory ? isExpanded : undefined}
								>
									{Array.from({ length: depth }, (_, i) => (
										<span key={i} className="file-tree-guide-line" style={{ ["--guide-index" as string]: String(i) }} aria-hidden="true" />
									))}
									<span className="file-tree-caret" aria-hidden="true">
										{entry.isDirectory ? <ChevronIcon expanded={isExpanded} /> : null}
									</span>
									<span className="file-tree-icon" aria-hidden="true">
										<FileTypeIcon entry={entry} />
									</span>
									<span className="file-tree-name" title={entry.path}>{entry.name}</span>
									{entry.isDirectory && childCount !== undefined ? <span className="file-tree-count">{childCount}</span> : null}
								</button>
								{entry.isDirectory && isExpanded ? (
									<div className="file-tree-children">
										{isLoading ? <div className="file-tree-loading">Loading…</div> : null}
										{renderEntries(entry.path, depth + 1)}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>
			);
		},
		[entriesByPath, expandedPaths, filterLower, loadingPaths, matchesFilter, onOpenFile, selectedPath, toggleDirectory],
	);

	const rendered = useMemo(() => renderEntries(rootPath, 0), [renderEntries, rootPath]);

	return (
		<div className="file-tree-surface workspace-file-tree-surface">
			<div className="file-tree-toolbar">
				<div className="file-tree-search">
					<svg className="file-tree-search-icon" viewBox="0 0 16 16" fill="none">
						<circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
						<path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
					</svg>
					<input
						type="text"
						className="file-tree-search-input"
						value={filterQuery}
						onChange={(event) => setFilterQuery(event.target.value)}
						placeholder="Filter files…"
						spellCheck={false}
					/>
					{filterQuery ? (
						<button type="button" className="file-tree-search-clear" onClick={() => setFilterQuery("")} aria-label="Clear filter">
							×
						</button>
					) : null}
				</div>
				<button
					type="button"
					className="file-tree-refresh"
					onClick={() => {
						void loadDirectory(rootPath);
					}}
					aria-label="Refresh file tree"
				>
					<svg viewBox="0 0 16 16" fill="none" className="file-tree-refresh-icon">
						<path d="M13.5 8a5.5 5.5 0 1 1-1.5-3.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
						<path d="M13.5 2.5v2.5H11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</div>
			{error ? <div className="file-tree-error">{error}</div> : null}
			<div className="file-tree-scroll">{rendered}</div>
		</div>
	);
}
