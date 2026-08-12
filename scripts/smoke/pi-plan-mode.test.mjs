import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function globalNodeModules() {
	const result = process.env.npm_execpath
		? spawnSync(process.execPath, [process.env.npm_execpath, "root", "-g"], { encoding: "utf8", timeout: 10_000 })
		: spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8", timeout: 10_000 });
	if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
	const besideNode = path.join(path.dirname(process.execPath), "node_modules");
	return existsSync(besideNode) ? besideNode : "";
}

function firstBuiltPackage(candidates, marker) {
	for (const candidate of candidates.filter(Boolean)) {
		if (existsSync(path.join(candidate, marker))) return candidate;
	}
	throw new Error(`Could not find a built Pi peer package containing ${marker}. Checked: ${candidates.join(", ")}`);
}

test("pi-plan-mode registers and enforces its core offline lifecycle", () => {
	const globalRoot = globalNodeModules();
	const repositoryNodeModules = path.resolve(repositoryRoot, "node_modules");
	const workspaceNodeModules = path.resolve(repositoryRoot, "../node_modules");
	const agentRoot = firstBuiltPackage(
		[
			process.env.PI_PLAN_MODE_AGENT_PACKAGE,
			path.join(repositoryNodeModules, "@earendil-works/pi-coding-agent"),
			path.join(workspaceNodeModules, "@earendil-works/pi-coding-agent"),
			globalRoot && path.join(globalRoot, "@earendil-works/pi-coding-agent"),
		],
		"dist/index.js",
	);
	const agentNodeModules = path.join(agentRoot, "node_modules");
	const agentPeerRoot = path.dirname(path.dirname(agentRoot));
	const tuiRoot = firstBuiltPackage(
		[
			path.join(agentNodeModules, "@earendil-works/pi-tui"),
			path.join(repositoryNodeModules, "@earendil-works/pi-tui"),
			path.join(agentPeerRoot, "@earendil-works/pi-tui"),
			path.join(workspaceNodeModules, "@earendil-works/pi-tui"),
		],
		"dist/index.js",
	);
	const typeboxRoot = firstBuiltPackage(
		[
			path.join(agentNodeModules, "typebox"),
			path.join(repositoryNodeModules, "typebox"),
			path.join(agentPeerRoot, "typebox"),
			path.join(workspaceNodeModules, "typebox"),
		],
		"package.json",
	);

	const fixtureRoot = mkdtempSync(path.join(tmpdir(), "pi-plan-mode-smoke-"));
	try {
		const pluginRoot = path.join(fixtureRoot, "plugin");
		cpSync(path.join(repositoryRoot, "extensions/pi-plan-mode"), pluginRoot, { recursive: true });
		const scopeRoot = path.join(fixtureRoot, "node_modules/@earendil-works");
		mkdirSync(scopeRoot, { recursive: true });
		symlinkSync(agentRoot, path.join(scopeRoot, "pi-coding-agent"), process.platform === "win32" ? "junction" : "dir");
		symlinkSync(tuiRoot, path.join(scopeRoot, "pi-tui"), process.platform === "win32" ? "junction" : "dir");
		symlinkSync(typeboxRoot, path.join(fixtureRoot, "node_modules/typebox"), process.platform === "win32" ? "junction" : "dir");

		const childSource = String.raw`
			import assert from "node:assert/strict";
			import { readFile } from "node:fs/promises";
			import path from "node:path";
			import { fileURLToPath } from "node:url";
			const { default: extension } = await import(process.argv[1]);
			const { initTheme } = await import(process.argv[3]);
			initTheme();

			const hooks = new Map();
			const commands = new Map();
			const tools = new Map();
			const shortcuts = [];
			const entries = [];
			const messages = [];
			const pluginDir = path.dirname(fileURLToPath(process.argv[1]));
			let activeTools = ["read", "bash", "edit", "write", "third-party"];
			let shadowRead = false;
			const builtIns = ["read", "bash", "edit", "write", "grep", "find", "ls"];
			const pi = {
				registerTool(definition) { tools.set(definition.name, definition); },
				registerCommand(name, definition) { commands.set(name, definition); },
				registerShortcut(key, definition) { shortcuts.push({ key, description: definition.description }); },
				on(name, handler) { const list = hooks.get(name) ?? []; list.push(handler); hooks.set(name, list); },
				getAllTools() {
					return [
						...builtIns.map((name) => ({
							name,
							sourceInfo: shadowRead && name === "read"
								? { path: "<malicious:read>", source: "local", scope: "temporary", origin: "top-level" }
								: { path: "<builtin:" + name + ">", source: "builtin", scope: "temporary", origin: "top-level" },
						})),
						{
							name: "third-party",
							sourceInfo: { path: "<third-party>", source: "local", scope: "temporary", origin: "top-level" },
						},
						...[...tools.values()].map((definition) => ({
							...definition,
							sourceInfo: { path: process.argv[1], source: "local", scope: "temporary", origin: "top-level", baseDir: pluginDir },
						})),
					];
				},
				getActiveTools() { return [...activeTools]; },
				setActiveTools(names) { activeTools = [...names]; },
				appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
				sendUserMessage(message) { messages.push(message); },
			};
			const notifications = [];
			const statuses = new Map();
			const reviewLines = [];
			const reviewKeys = ["a"];
			const ctx = {
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				sessionManager: {
					getSessionDir: () => process.argv[2],
					getSessionId: () => "smoke-session",
					getBranch: () => entries,
				},
				ui: {
					theme: { fg: (_style, text) => text },
					setStatus: (key, value) => statuses.set(key, value),
					notify: (message, level) => notifications.push({ message, level }),
					confirm: async () => true,
					editor: async () => "Add rollback details",
					custom: async (factory) => new Promise((resolve) => {
						const tui = { terminal: { rows: 30 }, requestRender() {} };
						const component = factory(tui, ctx.ui.theme, {}, resolve);
						reviewLines.push(component.render(90));
						component.handleInput(reviewKeys.shift() ?? "a");
					}),
				},
			};
			const runHook = async (name, event) => {
				let result;
				for (const handler of hooks.get(name) ?? []) {
					const next = await handler(event, ctx);
					if (next !== undefined) result = next;
				}
				return result;
			};

			try {
				extension(pi);
				await runHook("session_start", { type: "session_start", reason: "startup" });
				await commands.get("plan").handler("inspect the cache", ctx);
				const restricted = [...activeTools];
				const writeResult = await tools.get("write_plan").execute(
					"write-call",
					{ content: "# Smoke plan\n\n- Verify lifecycle" },
					new AbortController().signal,
					() => {},
					ctx,
				);
				const blocked = await runHook("tool_call", { toolName: "bash" });
				const blockedUserBash = await runHook("user_bash", { command: "echo unsafe" });
				const artifact = await readFile(path.join(process.argv[2], "pi-plan-mode/smoke-session/plan.md"), "utf8");
				const submitResult = await tools.get("submit_plan").execute(
					"submit-call",
					{},
					new AbortController().signal,
					() => {},
					ctx,
				);
				const settlingTools = [...activeTools];
				await runHook("agent_settled", { type: "agent_settled" });

				await commands.get("plan").handler("plan a second change", ctx);
				await tools.get("write_plan").execute(
					"write-call-2",
					{ content: "# Second plan\n\n- Initial version" },
					new AbortController().signal,
					() => {},
					ctx,
				);
				reviewKeys.push("r");
				const reviseResult = await tools.get("submit_plan").execute(
					"submit-call-2",
					{},
					new AbortController().signal,
					() => {},
					ctx,
				);
				const revisionTools = [...activeTools];
				reviewKeys.push("q");
				const abandonResult = await tools.get("submit_plan").execute(
					"submit-call-3",
					{},
					new AbortController().signal,
					() => {},
					ctx,
				);
				await runHook("agent_settled", { type: "agent_settled" });

				await commands.get("plan").handler("plan a third change", ctx);
				await tools.get("write_plan").execute(
					"write-call-3",
					{ content: "# Third plan\n\n- Reopen review" },
					new AbortController().signal,
					() => {},
					ctx,
				);
				reviewKeys.push("\u001b");
				const dismissResult = await tools.get("submit_plan").execute(
					"submit-call-4",
					{},
					new AbortController().signal,
					() => {},
					ctx,
				);
				const pendingTools = [...activeTools];
				reviewKeys.push("a");
				await commands.get("plan").handler("review", ctx);
				const reopenedTools = [...activeTools];
				shadowRead = true;
				await commands.get("plan").handler("this request must be refused", ctx);
				const shadowRefusal = notifications.at(-1);
				assert.equal(writeResult.isError, undefined);
				process.stdout.write(JSON.stringify({
					commands: [...commands.keys()],
					tools: [...tools.keys()],
					shortcuts,
					hooks: [...hooks.keys()],
					restricted,
					blocked,
					blockedUserBash,
					artifact,
					submitResult,
					settlingTools,
					reviseResult,
					revisionTools,
					abandonResult,
					dismissResult,
					pendingTools,
					reopenedTools,
					shadowRefusal,
					reviewLines,
					activeTools,
					messages,
				}));
				process.exit(0);
			} catch (error) {
				console.error(error);
				process.exit(1);
			}
		`;

		const child = spawnSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				childSource,
				pathToFileURL(path.join(pluginRoot, "index.ts")).href,
				path.join(fixtureRoot, "session"),
				pathToFileURL(path.join(agentRoot, "dist/index.js")).href,
			],
			{ encoding: "utf8", timeout: 30_000 },
		);
		assert.equal(child.status, 0, child.stderr || child.stdout);
		const result = JSON.parse(child.stdout);
		assert.deepEqual(result.commands, ["plan", "view-plan"]);
		assert.deepEqual(result.tools, ["write_plan", "submit_plan"]);
		assert.equal(result.shortcuts.length, 1);
		assert.equal(result.hooks.includes("session_tree"), true);
		assert.equal(result.hooks.includes("agent_settled"), true);
		assert.equal(result.hooks.includes("user_bash"), true);
		assert.deepEqual(result.restricted, ["read", "grep", "find", "ls", "write_plan", "submit_plan"]);
		assert.equal(result.blocked.block, true);
		assert.equal(result.blocked.terminate, true);
		assert.equal(result.blockedUserBash.result.exitCode, 1);
		assert.equal(result.blockedUserBash.result.output.includes("blocks direct shell commands"), true);
		assert.equal(result.artifact, "# Smoke plan\n\n- Verify lifecycle\n");
		assert.equal(result.submitResult.details.action, "approve", JSON.stringify(result.submitResult));
		assert.equal(result.submitResult.terminate, true);
		assert.deepEqual(result.settlingTools, ["read", "grep", "find", "ls"]);
		assert.equal(result.reviseResult.details.action, "revise");
		assert.equal(result.reviseResult.content[0].text.includes("Add rollback details"), true);
		assert.deepEqual(result.revisionTools, ["read", "grep", "find", "ls", "write_plan", "submit_plan"]);
		assert.equal(result.abandonResult.details.action, "abandon");
		assert.equal(result.abandonResult.terminate, true);
		assert.equal(result.dismissResult.details.action, "dismiss");
		assert.equal(result.dismissResult.terminate, true);
		assert.deepEqual(result.pendingTools, ["read", "grep", "find", "ls"]);
		assert.deepEqual(result.reopenedTools, ["read", "bash", "edit", "write", "third-party"]);
		assert.equal(result.shadowRefusal.level, "error");
		assert.equal(result.shadowRefusal.message.includes("read is provided by <malicious:read>"), true);
		assert.equal(result.reviewLines.flat().some((line) => line.includes("Plan Review")), true);
		assert.equal(result.reviewLines.flat().some((line) => line.includes("Smoke plan")), true);
		assert.deepEqual(result.activeTools, ["read", "bash", "edit", "write", "third-party"]);
		assert.deepEqual(result.messages, ["inspect the cache", "plan a second change", "plan a third change"]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});
