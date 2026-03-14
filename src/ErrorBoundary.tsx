import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = {
		hasError: false,
		message: "",
	};

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return {
			hasError: true,
			message: error.message,
		};
	}

	componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
		console.error("Mosaic renderer crashed:", error);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="fatal-shell">
					<div className="fatal-card glass-panel">
						<div className="eyebrow">Renderer Error</div>
						<h1>Mosaic hit a startup problem.</h1>
						<p>The UI failed to render fully, but the app is still alive.</p>
						<code>{this.state.message || "Unknown renderer error"}</code>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
