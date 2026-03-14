export function normalizeShellLabel(shell: string) {
	return shell.split(/[\\/]/).pop() || shell;
}
