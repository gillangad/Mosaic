export interface MosaicTheme {
	id: string;
	name: string;
	kind: "dark" | "light";

	// Backgrounds
	bgVoid: string;
	bgSurface: string;
	bgWell: string;

	// Borders
	borderDim: string;
	borderGlow: string;

	// Text
	textPrimary: string;
	textSecondary: string;
	textMuted: string;

	// Status
	statusSuccess: string;
	statusWarn: string;
	statusError: string;

	// Workspace accents
	accents: {
		product: string;
		engineering: string;
		research: string;
		ops: string;
	};

	// xterm terminal colors
	terminal: {
		foreground: string;
		cursor: string;
		cursorAccent: string;
		selectionBackground: string;
		black: string;
		brightBlack: string;
		red: string;
		green: string;
		yellow: string;
		blue: string;
		magenta: string;
		cyan: string;
		white: string;
		brightWhite: string;
	};
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function hexToRgb(color: string) {
	const value = color.trim().replace("#", "");
	if (value.length !== 3 && value.length !== 6) return null;
	const normalized = value.length === 3 ? value.split("").map((part) => `${part}${part}`).join("") : value;
	const int = Number.parseInt(normalized, 16);
	if (Number.isNaN(int)) return null;
	return {
		r: (int >> 16) & 255,
		g: (int >> 8) & 255,
		b: int & 255,
	};
}

function rgbToHex(r: number, g: number, b: number) {
	const toHex = (value: number) => value.toString(16).padStart(2, "0");
	return `#${toHex(clamp(Math.round(r), 0, 255))}${toHex(clamp(Math.round(g), 0, 255))}${toHex(clamp(Math.round(b), 0, 255))}`;
}

function blendHex(base: string, target: string, ratio: number) {
	const left = hexToRgb(base);
	const right = hexToRgb(target);
	if (!left || !right) return base;
	const t = clamp(ratio, 0, 1);
	return rgbToHex(
		left.r + (right.r - left.r) * t,
		left.g + (right.g - left.g) * t,
		left.b + (right.b - left.b) * t,
	);
}

function relativeLuminance(color: string) {
	const rgb = hexToRgb(color);
	if (!rgb) return 0;
	const channel = (value: number) => {
		const srgb = value / 255;
		return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a: string, b: string) {
	const first = relativeLuminance(a);
	const second = relativeLuminance(b);
	const light = Math.max(first, second);
	const dark = Math.min(first, second);
	return (light + 0.05) / (dark + 0.05);
}

function enforceThemeConstraints(themeMap: Record<string, MosaicTheme>) {
	const normalized: Record<string, MosaicTheme> = {};
	const dominantAccentRegistry = new Map<string, string>();

	for (const [id, theme] of Object.entries(themeMap)) {
		const nextTheme: MosaicTheme = {
			...theme,
			bgWell: theme.bgSurface,
			terminal: {
				...theme.terminal,
			},
		};

		if (contrastRatio(nextTheme.textPrimary, nextTheme.bgSurface) < 4.8) {
			nextTheme.textPrimary = nextTheme.kind === "light"
				? blendHex(nextTheme.textPrimary, "#050505", 0.28)
				: blendHex(nextTheme.textPrimary, "#f6f6f9", 0.22);
		}
		if (contrastRatio(nextTheme.textSecondary, nextTheme.bgSurface) < 3.0) {
			nextTheme.textSecondary = nextTheme.kind === "light"
				? blendHex(nextTheme.textSecondary, "#111111", 0.18)
				: blendHex(nextTheme.textSecondary, "#d0d0d6", 0.22);
		}
		if (contrastRatio(nextTheme.terminal.foreground, nextTheme.bgWell) < 4.5) {
			nextTheme.terminal.foreground = nextTheme.textPrimary;
		}
		if (contrastRatio(nextTheme.terminal.cursor, nextTheme.bgWell) < 3.0) {
			nextTheme.terminal.cursor = nextTheme.accents.product;
		}

		if (nextTheme.kind === "dark" && nextTheme.bgVoid.toLowerCase() === "#000000") {
			nextTheme.bgVoid = blendHex(nextTheme.bgSurface, "#020205", 0.72);
		}

		const dominantAccent = nextTheme.accents.product.toLowerCase();
		const existingTheme = dominantAccentRegistry.get(dominantAccent);
		if (existingTheme) {
			throw new Error(`Theme accent collision: ${id} duplicates ${existingTheme} dominant accent ${nextTheme.accents.product}`);
		}
		dominantAccentRegistry.set(dominantAccent, id);
		normalized[id] = nextTheme;
	}

	return normalized;
}

const baseThemes: Record<string, MosaicTheme> = {
	midnight: {
		id: "midnight",
		name: "Midnight",
		kind: "dark",

		bgVoid: "#0a0a0a",
		bgSurface: "#111111",
		bgWell: "#141414",

		borderDim: "rgba(255, 255, 255, 0.06)",
		borderGlow: "rgba(255, 255, 255, 0.12)",

		textPrimary: "#ededed",
		textSecondary: "#888888",
		textMuted: "#555555",

		statusSuccess: "#3ddc97",
		statusWarn: "#f0b35a",
		statusError: "#ef4444",

		accents: {
			product: "#7aa2ff",
			engineering: "#73d4ff",
			research: "#b28cff",
			ops: "#f0b35a",
		},

		terminal: {
			foreground: "#d4d4d4",
			cursor: "#ededed",
			cursorAccent: "#141414",
			selectionBackground: "rgba(255, 255, 255, 0.08)",
			black: "#0a0a0a",
			brightBlack: "#555555",
			red: "#ef4444",
			green: "#3ddc97",
			yellow: "#f0b35a",
			blue: "#7aa2ff",
			magenta: "#b28cff",
			cyan: "#73d4ff",
			white: "#d4d4d4",
			brightWhite: "#fafafa",
		},
	},


	ember: {
		id: "ember",
		name: "Ember",
		kind: "dark",

		bgVoid: "#0e0804",
		bgSurface: "#161009",
		bgWell: "#161009",

		borderDim: "rgba(214, 156, 78, 0.10)",
		borderGlow: "rgba(214, 156, 78, 0.22)",

		textPrimary: "#f0dcc0",
		textSecondary: "#9a7e5e",
		textMuted: "#5a4430",

		statusSuccess: "#b5d07a",
		statusWarn: "#e8a735",
		statusError: "#d44830",

		accents: {
			product: "#e8a735",
			engineering: "#d07a4a",
			research: "#c97ab0",
			ops: "#b5d07a",
		},

		terminal: {
			foreground: "#e0cbb0",
			cursor: "#e8a735",
			cursorAccent: "#161009",
			selectionBackground: "rgba(232, 167, 53, 0.12)",
			black: "#0e0804",
			brightBlack: "#5a4430",
			red: "#d44830",
			green: "#b5d07a",
			yellow: "#e8a735",
			blue: "#6a9ec0",
			magenta: "#c97ab0",
			cyan: "#7abcb0",
			white: "#e0cbb0",
			brightWhite: "#f5ead8",
		},
	},

	oxide: {
		id: "oxide",
		name: "Oxide",
		kind: "dark",

		bgVoid: "#08090c",
		bgSurface: "#0e1017",
		bgWell: "#0e1017",

		borderDim: "rgba(100, 140, 200, 0.08)",
		borderGlow: "rgba(100, 140, 200, 0.18)",

		textPrimary: "#c4cede",
		textSecondary: "#5e6e84",
		textMuted: "#333d4e",

		statusSuccess: "#58c48a",
		statusWarn: "#d4a64e",
		statusError: "#c4484a",

		accents: {
			product: "#4a90d4",
			engineering: "#58c48a",
			research: "#8a6cd4",
			ops: "#d4a64e",
		},

		terminal: {
			foreground: "#b4c0d0",
			cursor: "#4a90d4",
			cursorAccent: "#0e1017",
			selectionBackground: "rgba(74, 144, 212, 0.12)",
			black: "#08090c",
			brightBlack: "#3a4558",
			red: "#c4484a",
			green: "#58c48a",
			yellow: "#d4a64e",
			blue: "#4a90d4",
			magenta: "#8a6cd4",
			cyan: "#4ab0c0",
			white: "#b4c0d0",
			brightWhite: "#dce4ee",
		},
	},

	bone: {
		id: "bone",
		name: "Bone",
		kind: "light",

		bgVoid: "#f2efe8",
		bgSurface: "#faf8f4",
		bgWell: "#faf8f4",

		borderDim: "rgba(0, 0, 0, 0.07)",
		borderGlow: "rgba(0, 0, 0, 0.14)",

		textPrimary: "#1c1a16",
		textSecondary: "#6e695e",
		textMuted: "#a8a296",

		statusSuccess: "#3a7a50",
		statusWarn: "#9a7028",
		statusError: "#a83830",

		accents: {
			product: "#8a6840",
			engineering: "#3a7a50",
			research: "#6a5090",
			ops: "#9a7028",
		},

		terminal: {
			foreground: "#2e2a24",
			cursor: "#8a6840",
			cursorAccent: "#faf8f4",
			selectionBackground: "rgba(138, 104, 64, 0.12)",
			black: "#2e2a24",
			brightBlack: "#6e695e",
			red: "#a83830",
			green: "#3a7a50",
			yellow: "#9a7028",
			blue: "#38608a",
			magenta: "#6a5090",
			cyan: "#2a7878",
			white: "#f2efe8",
			brightWhite: "#faf8f4",
		},
	},

	kark: {
		id: "kark",
		name: "Kark",
		kind: "dark",

		bgVoid: "#09090b",
		bgSurface: "#121214",
		bgWell: "#121214",

		borderDim: "rgba(255, 255, 255, 0.05)",
		borderGlow: "rgba(255, 255, 255, 0.14)",

		textPrimary: "#e8e8ec",
		textSecondary: "#78787e",
		textMuted: "#3a3a40",

		statusSuccess: "#b0b0b6",
		statusWarn: "#9a9a9f",
		statusError: "#808085",

		accents: {
			product: "#d0d0d6",
			engineering: "#a0a0a8",
			research: "#babac2",
			ops: "#8a8a92",
		},

		terminal: {
			foreground: "#c4c4ca",
			cursor: "#e8e8ec",
			cursorAccent: "#121214",
			selectionBackground: "rgba(255, 255, 255, 0.08)",
			black: "#09090b",
			brightBlack: "#48484e",
			red: "#909096",
			green: "#b0b0b6",
			yellow: "#9a9a9f",
			blue: "#a0a0a8",
			magenta: "#8a8a92",
			cyan: "#babac2",
			white: "#c4c4ca",
			brightWhite: "#f0f0f4",
		},
	},

	carbon: {
		id: "carbon",
		name: "Carbon",
		kind: "dark",

		bgVoid: "#0c0c0e",
		bgSurface: "#131316",
		bgWell: "#131316",

		borderDim: "rgba(255, 255, 255, 0.06)",
		borderGlow: "rgba(255, 255, 255, 0.13)",

		textPrimary: "#e4e4e7",
		textSecondary: "#71717a",
		textMuted: "#3f3f46",

		statusSuccess: "#86d993",
		statusWarn: "#c8a44e",
		statusError: "#e5534b",

		accents: {
			product: "#c8a44e",
			engineering: "#7eb8c9",
			research: "#a78bda",
			ops: "#d4886a",
		},

		terminal: {
			foreground: "#cdd6f4",
			cursor: "#c8a44e",
			cursorAccent: "#131316",
			selectionBackground: "rgba(199, 164, 78, 0.15)",
			black: "#0c0c0e",
			brightBlack: "#45475a",
			red: "#e5534b",
			green: "#86d993",
			yellow: "#e0c078",
			blue: "#7eb8c9",
			magenta: "#a78bda",
			cyan: "#7ec9b8",
			white: "#bac2de",
			brightWhite: "#e4e4e7",
		},
	},
};

export const themes = enforceThemeConstraints(baseThemes);
export const themeIds = Object.keys(themes) as Array<keyof typeof themes>;
export const defaultThemeId = "carbon";
