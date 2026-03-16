import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserTabModel, PaneTabModel } from "../core/models";
import type { MosaicTheme } from "../core/themes";

type BrowserWebviewElement = HTMLElement & {
	canGoBack?: () => boolean;
	canGoForward?: () => boolean;
	goBack?: () => void;
	goForward?: () => void;
	reload?: () => void;
	stop?: () => void;
	loadURL?: (url: string) => void;
	getURL?: () => string;
	getTitle?: () => string;
	getWebContentsId?: () => number;
	addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
	removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

function normalizeBrowserUrl(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return "about:blank";
	if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) return trimmed;
	if (trimmed.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+(:\d+)?/.test(trimmed)) return `http://${trimmed}`;
	return `https://${trimmed}`;
}

function resolveBrowserTitle(title: string, url: string) {
	const normalizedTitle = title.trim();
	if (normalizedTitle.length > 0) return normalizedTitle;
	if (url === "about:blank") return "Browser";
	return url;
}

function safeInvoke<T>(action: () => T, fallback: T): T {
	try {
		return action();
	} catch {
		return fallback;
	}
}

interface BrowserPaneProps {
	tab: BrowserTabModel;
	theme: MosaicTheme;
	isActive: boolean;
	onUpdateTab: (tabId: string, updater: (tab: PaneTabModel) => PaneTabModel) => void;
}

export function BrowserPane({ tab, theme, isActive, onUpdateTab }: BrowserPaneProps) {
	const webviewRef = useRef<BrowserWebviewElement | null>(null);
	const cdpResolvedWebContentsIdRef = useRef<number | null>(null);
	const [inputValue, setInputValue] = useState(tab.url || "about:blank");
	const [navigationState, setNavigationState] = useState({ canGoBack: false, canGoForward: false, loading: false });
	const [cdpTarget, setCdpTarget] = useState<string | null>(null);
	const [webviewReady, setWebviewReady] = useState(false);

	useEffect(() => {
		setInputValue(tab.url || "about:blank");
	}, [tab.id, tab.url]);

	useEffect(() => {
		cdpResolvedWebContentsIdRef.current = null;
		setWebviewReady(false);
		setCdpTarget(null);
		setNavigationState((current) => ({ ...current, canGoBack: false, canGoForward: false, loading: false }));
	}, [tab.id]);

	const commitTabNavigation = useCallback(
		(nextUrl: string, nextTitle?: string) => {
			onUpdateTab(tab.id, (current) => {
				if (current.kind !== "browser") return current;
				const normalizedUrl = nextUrl || current.url || "about:blank";
				const resolvedTitle = resolveBrowserTitle(nextTitle ?? current.title, normalizedUrl);
				if (current.url === normalizedUrl && current.title === resolvedTitle) return current;
				return {
					...current,
					url: normalizedUrl,
					title: resolvedTitle,
				};
			});
		},
		[onUpdateTab, tab.id],
	);

	const refreshNavigationState = useCallback(() => {
		const view = webviewRef.current;
		if (!view || !webviewReady) return;
		setNavigationState((current) => {
			const next = {
				canGoBack: safeInvoke(() => view.canGoBack?.() ?? false, false),
				canGoForward: safeInvoke(() => view.canGoForward?.() ?? false, false),
				loading: current.loading,
			};
			if (
				next.canGoBack === current.canGoBack &&
				next.canGoForward === current.canGoForward &&
				next.loading === current.loading
			) {
				return current;
			}
			return next;
		});
	}, [webviewReady]);

	const refreshCdpTarget = useCallback(async () => {
		if (typeof window === "undefined" || typeof window.mosaic === "undefined" || !webviewReady) return;
		const view = webviewRef.current;
		if (!view?.getWebContentsId) return;
		const webContentsId = safeInvoke(() => view.getWebContentsId?.() ?? 0, 0);
		if (!Number.isFinite(webContentsId) || webContentsId <= 0) return;
		if (cdpResolvedWebContentsIdRef.current === webContentsId) return;
		try {
			const target = await window.mosaic.getBrowserCdpTarget(
				webContentsId,
				safeInvoke(() => view.getURL?.() ?? tab.url, tab.url),
				safeInvoke(() => view.getTitle?.() ?? tab.title, tab.title),
			);
			cdpResolvedWebContentsIdRef.current = webContentsId;
			setCdpTarget(target?.webSocketDebuggerUrl ?? null);
		} catch {
			setCdpTarget(null);
		}
	}, [tab.title, tab.url, webviewReady]);

	useEffect(() => {
		if (!webviewReady) return;
		refreshNavigationState();
		void refreshCdpTarget();
	}, [refreshCdpTarget, refreshNavigationState, webviewReady]);

	useEffect(() => {
		const view = webviewRef.current;
		if (!view) return;

		const handleDomReady = () => {
			setWebviewReady(true);
		};

		const handleTitleUpdated = (event: Event) => {
			if (!webviewReady) return;
			const customEvent = event as Event & { title?: string };
			const nextTitle = customEvent.title ?? safeInvoke(() => view.getTitle?.() ?? "Browser", "Browser");
			const nextUrl = safeInvoke(() => view.getURL?.() ?? tab.url, tab.url);
			commitTabNavigation(nextUrl, nextTitle);
		};

		const handleNavigate = () => {
			if (!webviewReady) return;
			const nextUrl = safeInvoke(() => view.getURL?.() ?? tab.url, tab.url);
			setInputValue(nextUrl);
			commitTabNavigation(nextUrl, safeInvoke(() => view.getTitle?.() ?? tab.title, tab.title));
			refreshNavigationState();
		};

		const handleStartLoading = () => {
			setNavigationState((current) => ({ ...current, loading: true }));
		};

		const handleStopLoading = () => {
			setNavigationState((current) => ({ ...current, loading: false }));
			refreshNavigationState();
		};

		const handleGone = () => {
			setWebviewReady(false);
			setCdpTarget(null);
			setNavigationState((current) => ({ ...current, canGoBack: false, canGoForward: false, loading: false }));
		};

		view.addEventListener("dom-ready", handleDomReady);
		view.addEventListener("page-title-updated", handleTitleUpdated);
		view.addEventListener("did-navigate", handleNavigate);
		view.addEventListener("did-navigate-in-page", handleNavigate);
		view.addEventListener("did-start-loading", handleStartLoading);
		view.addEventListener("did-stop-loading", handleStopLoading);
		view.addEventListener("did-finish-load", handleNavigate);
		view.addEventListener("destroyed", handleGone);
		view.addEventListener("crashed", handleGone);
		view.addEventListener("render-process-gone", handleGone);

		return () => {
			view.removeEventListener("dom-ready", handleDomReady);
			view.removeEventListener("page-title-updated", handleTitleUpdated);
			view.removeEventListener("did-navigate", handleNavigate);
			view.removeEventListener("did-navigate-in-page", handleNavigate);
			view.removeEventListener("did-start-loading", handleStartLoading);
			view.removeEventListener("did-stop-loading", handleStopLoading);
			view.removeEventListener("did-finish-load", handleNavigate);
			view.removeEventListener("destroyed", handleGone);
			view.removeEventListener("crashed", handleGone);
			view.removeEventListener("render-process-gone", handleGone);
		};
	}, [commitTabNavigation, refreshCdpTarget, refreshNavigationState, tab.title, tab.url, webviewReady]);

	const navigateToInput = useCallback(() => {
		const nextUrl = normalizeBrowserUrl(inputValue);
		setInputValue(nextUrl);
		commitTabNavigation(nextUrl, tab.title);
		const view = webviewRef.current;
		if (!view || !webviewReady) return;
		safeInvoke(() => {
			view.loadURL?.(nextUrl);
			return null;
		}, null);
	}, [commitTabNavigation, inputValue, tab.title, webviewReady]);

	const browserThemeClass = useMemo(() => (theme.kind === "light" ? "browser-pane-light" : "browser-pane-dark"), [theme.kind]);

	return (
		<div className={`pane-tab-surface ${isActive ? "active" : "inactive"} browser-pane-surface ${browserThemeClass} tw-flex tw-min-h-0 tw-flex-1 tw-flex-col`}>
			<div className="browser-toolbar tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1">
				<button
					type="button"
					className="browser-toolbar-button"
					onClick={() => {
						const view = webviewRef.current;
						if (!view || !webviewReady) return;
						safeInvoke(() => {
							view.goBack?.();
							return null;
						}, null);
					}}
					disabled={!navigationState.canGoBack}
					aria-label="Back"
				>
					←
				</button>
				<button
					type="button"
					className="browser-toolbar-button"
					onClick={() => {
						const view = webviewRef.current;
						if (!view || !webviewReady) return;
						safeInvoke(() => {
							view.goForward?.();
							return null;
						}, null);
					}}
					disabled={!navigationState.canGoForward}
					aria-label="Forward"
				>
					→
				</button>
				<button
					type="button"
					className="browser-toolbar-button"
					onClick={() => {
						const view = webviewRef.current;
						if (!view || !webviewReady) return;
						safeInvoke(() => {
							view.reload?.();
							return null;
						}, null);
					}}
					aria-label="Reload"
				>
					{navigationState.loading ? "◌" : "↻"}
				</button>
				<input
					type="text"
					className="browser-url-input tw-min-w-0 tw-flex-1"
					value={inputValue}
					onChange={(event) => setInputValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						navigateToInput();
					}}
					spellCheck={false}
					aria-label="Browser URL"
				/>
				{cdpTarget ? (
					<button
						type="button"
						className="browser-toolbar-button browser-cdp-badge"
						title={cdpTarget}
						onClick={() => void navigator.clipboard?.writeText(`agent-browser --cdp 9222 snapshot`)}
					>
						CDP
					</button>
				) : null}
			</div>
			<div className="browser-webview-wrap tw-min-h-0 tw-flex-1">
				<webview
					key={tab.id}
					ref={(element) => {
						webviewRef.current = element as BrowserWebviewElement | null;
					}}
					className="browser-webview"
					src={tab.url || "about:blank"}
				/>
			</div>
		</div>
	);
}
