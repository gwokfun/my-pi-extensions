import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("grok-tui registers its command and rejects non-interactive mode safely", () => {
	const bundledCli = path.join(path.dirname(process.execPath), "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
	const piCommand = existsSync(bundledCli) ? process.execPath : process.platform === "win32" ? "pi.cmd" : "pi";
	const piPrefix = existsSync(bundledCli) ? [bundledCli] : [];
	const sessionDir = mkdtempSync(path.join(tmpdir(), "grok-tui-smoke-"));
	try {
		const result = spawnSync(
			piCommand,
			[
				...piPrefix,
				"--mode",
				"rpc",
				"--no-session",
				"--session-dir",
				sessionDir,
				"--offline",
				"--no-tools",
				"--no-extensions",
				"--extension",
				path.join(repositoryRoot, "extensions/grok-tui/index.ts"),
			],
			{
				cwd: repositoryRoot,
				input: `${JSON.stringify({ type: "prompt", message: "/grok-tui" })}\n`,
				encoding: "utf8",
				timeout: 30_000,
				windowsHide: true,
				shell: piPrefix.length === 0 && process.platform === "win32",
			},
		);

		assert.equal(result.status, 0, result.stderr);
		const events = result.stdout
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		assert.ok(events.some((event) => event.type === "response" && event.command === "prompt" && event.success === true));
		assert.ok(events.some((event) => event.type === "extension_ui_request" && event.method === "notify" && /interactive TUI mode/.test(event.message)));
	} finally {
		rmSync(sessionDir, { recursive: true, force: true });
	}
});
