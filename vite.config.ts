import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	base: "./",
	plugins: [react()],
	server: {
		port: 5181,
		strictPort: true,
	},
	build: {
		modulePreload: false,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("@monaco-editor/react") || id.includes("monaco-editor")) return "monaco";
					if (id.includes("framer-motion")) return "framer-motion";
					if (id.includes("xterm") || id.includes("xterm-addon")) return "terminal";
					if (id.includes("@milkdown")) return "milkdown";
					if (id.includes("react-pdf") || id.includes("pdfjs-dist")) return "pdf";
					return undefined;
				},
			},
		},
	},
});
