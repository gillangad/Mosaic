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

export const themes: Record<string, MosaicTheme> = {
	jade: {
		id: "jade",
		name: "Jade Terminal",
		kind: "dark",

		bgVoid: "#0a100e",
		bgSurface: "#111d18",
		bgWell: "#0a120f",

		borderDim: "#1a2a24",
		borderGlow: "#2a3a34",

		textPrimary: "#c0d4c8",
		textSecondary: "#5a7a6a",
		textMuted: "#2e4a3a",

		statusSuccess: "#34d399",
		statusWarn: "#e8a634",
		statusError: "#e85454",

		accents: {
			product: "#34d399",
			engineering: "#4a9e8a",
			research: "#8abeb7",
			ops: "#e8a634",
		},

		terminal: {
			foreground: "#b0c8b8",
			cursor: "#34d399",
			cursorAccent: "#0a120f",
			selectionBackground: "#ffffff12",
			black: "#0a100e",
			brightBlack: "#3a5a4a",
			red: "#e85454",
			green: "#34d399",
			yellow: "#e8a634",
			blue: "#5a9abf",
			magenta: "#9b7acc",
			cyan: "#4a9e8a",
			white: "#c0d4c8",
			brightWhite: "#e0f0e8",
		},
	},

	deepsea: {
		id: "deepsea",
		name: "Deep Sea",
		kind: "dark",

		bgVoid: "#0a0f1a",
		bgSurface: "#0e1628",
		bgWell: "#080e1a",

		borderDim: "#15213a",
		borderGlow: "#1e3050",

		textPrimary: "#b8c8d8",
		textSecondary: "#5a7a9a",
		textMuted: "#2a3a5a",

		statusSuccess: "#34d399",
		statusWarn: "#f0c674",
		statusError: "#f87171",

		accents: {
			product: "#22d3ee",
			engineering: "#3b82f6",
			research: "#818cf8",
			ops: "#f0c674",
		},

		terminal: {
			foreground: "#a0b8cc",
			cursor: "#22d3ee",
			cursorAccent: "#080e1a",
			selectionBackground: "#ffffff10",
			black: "#0a0f1a",
			brightBlack: "#2a3a5a",
			red: "#f87171",
			green: "#34d399",
			yellow: "#f0c674",
			blue: "#3b82f6",
			magenta: "#818cf8",
			cyan: "#22d3ee",
			white: "#b8c8d8",
			brightWhite: "#dce8f0",
		},
	},

	nordic: {
		id: "nordic",
		name: "Nordic Frost",
		kind: "dark",

		bgVoid: "#0f1923",
		bgSurface: "#141f2b",
		bgWell: "#0c1520",

		borderDim: "#1e2d3d",
		borderGlow: "#2a3d50",

		textPrimary: "#c8d4de",
		textSecondary: "#6a8a9a",
		textMuted: "#2e4050",

		statusSuccess: "#a3be8c",
		statusWarn: "#ebcb8b",
		statusError: "#bf616a",

		accents: {
			product: "#88c0d0",
			engineering: "#a3be8c",
			research: "#b48ead",
			ops: "#d08770",
		},

		terminal: {
			foreground: "#b0bec8",
			cursor: "#88c0d0",
			cursorAccent: "#0c1520",
			selectionBackground: "#ffffff10",
			black: "#0f1923",
			brightBlack: "#3b4b5b",
			red: "#bf616a",
			green: "#a3be8c",
			yellow: "#ebcb8b",
			blue: "#5e81ac",
			magenta: "#b48ead",
			cyan: "#88c0d0",
			white: "#c8d4de",
			brightWhite: "#e5eaf0",
		},
	},

	dusk: {
		id: "dusk",
		name: "Dusk",
		kind: "dark",

		bgVoid: "#13111a",
		bgSurface: "#1a1624",
		bgWell: "#100e18",

		borderDim: "#2a2235",
		borderGlow: "#3a2a48",

		textPrimary: "#c8c0d4",
		textSecondary: "#8a7a9a",
		textMuted: "#3a2a4a",

		statusSuccess: "#a0e8c4",
		statusWarn: "#e8c880",
		statusError: "#e87a7a",

		accents: {
			product: "#e8a0c0",
			engineering: "#c4a0e8",
			research: "#a0b8e8",
			ops: "#e8c880",
		},

		terminal: {
			foreground: "#b8b0c8",
			cursor: "#c4a0e8",
			cursorAccent: "#100e18",
			selectionBackground: "#ffffff10",
			black: "#13111a",
			brightBlack: "#3a2a4a",
			red: "#e87a7a",
			green: "#a0e8c4",
			yellow: "#e8c880",
			blue: "#a0b8e8",
			magenta: "#c4a0e8",
			cyan: "#88c8d8",
			white: "#c8c0d4",
			brightWhite: "#e8e0f0",
		},
	},

	brutalist: {
		id: "brutalist",
		name: "Brutalist Dark",
		kind: "dark",

		bgVoid: "#050505",
		bgSurface: "#0f0f0f",
		bgWell: "#090909",

		borderDim: "#2c2c2c",
		borderGlow: "#505050",

		textPrimary: "#f0f0f0",
		textSecondary: "#9a9a9a",
		textMuted: "#5a5a5a",

		statusSuccess: "#7dff73",
		statusWarn: "#ffd447",
		statusError: "#ff5a5a",

		accents: {
			product: "#ffffff",
			engineering: "#b8b8b8",
			research: "#8e8e8e",
			ops: "#ffd447",
		},

		terminal: {
			foreground: "#f0f0f0",
			cursor: "#ffffff",
			cursorAccent: "#090909",
			selectionBackground: "#ffffff18",
			black: "#050505",
			brightBlack: "#3e3e3e",
			red: "#ff5a5a",
			green: "#7dff73",
			yellow: "#ffd447",
			blue: "#9a9a9a",
			magenta: "#d0d0d0",
			cyan: "#cfcfcf",
			white: "#f0f0f0",
			brightWhite: "#ffffff",
		},
	},

	marble: {
		id: "marble",
		name: "Marble Light",
		kind: "light",

		bgVoid: "#f4f1ec",
		bgSurface: "#ffffff",
		bgWell: "#eae6e0",

		borderDim: "#d8d2c8",
		borderGlow: "#c0b8aa",

		textPrimary: "#2a2520",
		textSecondary: "#7a7268",
		textMuted: "#b8b0a4",

		statusSuccess: "#2a7a50",
		statusWarn: "#a07a28",
		statusError: "#b83a3a",

		accents: {
			product: "#3a7a6a",
			engineering: "#5a6abf",
			research: "#8a5aa0",
			ops: "#b86a2a",
		},

		terminal: {
			foreground: "#3a3530",
			cursor: "#3a7a6a",
			cursorAccent: "#ffffff",
			selectionBackground: "#00000010",
			black: "#2a2520",
			brightBlack: "#7a7268",
			red: "#b83a3a",
			green: "#2a7a50",
			yellow: "#a07a28",
			blue: "#5a6abf",
			magenta: "#8a5aa0",
			cyan: "#3a7a6a",
			white: "#f4f1ec",
			brightWhite: "#ffffff",
		},
	},
};

export const themeIds = Object.keys(themes) as Array<keyof typeof themes>;
export const defaultThemeId = "jade";
