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

test("ask-user-questions registers, renders, collects answers, and rejects non-TUI execution", () => {
	const globalRoot = globalNodeModules();
	const workspaceNodeModules = path.resolve(repositoryRoot, "../node_modules");
	const agentRoot = firstBuiltPackage(
		[
			process.env.PI_ASK_USER_AGENT_PACKAGE,
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
			path.join(agentPeerRoot, "@earendil-works/pi-tui"),
			path.join(workspaceNodeModules, "@earendil-works/pi-tui"),
		],
		"dist/index.js",
	);
	const typeboxRoot = firstBuiltPackage(
		[path.join(agentNodeModules, "typebox"), path.join(agentPeerRoot, "typebox"), path.join(workspaceNodeModules, "typebox")],
		"package.json",
	);

	const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ask-user-questions-smoke-"));
	try {
		const pluginRoot = path.join(fixtureRoot, "plugin");
		cpSync(path.join(repositoryRoot, "extensions/ask-user-questions"), pluginRoot, { recursive: true });
		const scopeRoot = path.join(fixtureRoot, "node_modules/@earendil-works");
		mkdirSync(scopeRoot, { recursive: true });
		symlinkSync(agentRoot, path.join(scopeRoot, "pi-coding-agent"), process.platform === "win32" ? "junction" : "dir");
		symlinkSync(tuiRoot, path.join(scopeRoot, "pi-tui"), process.platform === "win32" ? "junction" : "dir");
		symlinkSync(typeboxRoot, path.join(fixtureRoot, "node_modules/typebox"), process.platform === "win32" ? "junction" : "dir");

		const childSource = String.raw`
			import assert from "node:assert/strict";
			const { default: extension } = await import(process.argv[1]);
			const tools = new Map();
			const pi = { registerTool(definition) { tools.set(definition.name, definition); } };
			extension(pi);
			const tool = tools.get("ask_user_questions");
			assert.ok(tool);

			const theme = {
				fg: (_style, text) => text,
				bg: (_style, text) => text,
				bold: (text) => text,
			};
			const renders = [];
			const ctx = {
				mode: "tui",
				hasUI: true,
				ui: {
					theme,
					custom: async (factory) => new Promise((resolve) => {
						const tui = { terminal: { rows: 28 }, requestRender() {} };
						const component = factory(tui, theme, {}, resolve);
						component.focused = true;
						renders.push(component.render(92));
						component.handleInput("2");
						renders.push(component.render(92));
						component.handleInput(" ");
						component.handleInput("\u001b[B");
						component.handleInput(" ");
						component.handleInput("\r");
						renders.push(component.render(92));
						component.handleInput("\r");
					}),
				},
			};
			const params = {
				questions: [
					{
						id: "scope",
						header: "Scope",
						question: "Which delivery scope should we use?",
						options: [
							{ label: "Focused", description: "Keep the change small.", recommended: true },
							{ label: "Complete", description: "Include all related work." },
						],
					},
					{
						id: "checks",
						header: "Checks",
						question: "Which checks should be included?",
						multiSelect: true,
						options: [
							{ label: "Unit tests" },
							{ label: "Smoke tests" },
							{ label: "Manual TUI" },
						],
					},
				],
			};
			const result = await tool.execute("ask-call", params, new AbortController().signal, undefined, ctx);
			const oneQuestion = {
				questions: [{
					id: "custom_scope",
					header: "Custom",
					question: "What scope should we use?",
					options: [{ label: "Small" }, { label: "Large" }],
				}],
			};
			const customCtx = {
				mode: "tui",
				ui: {
					custom: async (factory) => new Promise((resolve) => {
						const component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, {}, resolve);
						component.focused = true;
						component.handleInput("3");
						for (const character of "A tailored scope") component.handleInput(character);
						component.handleInput("\r");
					}),
				},
			};
			const customResult = await tool.execute("ask-custom", oneQuestion, undefined, undefined, customCtx);
			const cancelCtx = {
				mode: "tui",
				ui: {
					custom: async (factory) => new Promise((resolve) => {
						const component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, {}, resolve);
						component.handleInput("\u001b");
						component.handleInput("\u001b");
					}),
				},
			};
			const cancelResult = await tool.execute("ask-cancel", oneQuestion, undefined, undefined, cancelCtx);
			const nonTui = await tool.execute("ask-rpc", params, undefined, undefined, { mode: "rpc" });
			const callLines = tool.renderCall(params, theme, {}).render(100);
			const resultLines = tool.renderResult(result, { expanded: false }, theme, {}).render(100);
			process.stdout.write(JSON.stringify({
				toolNames: [...tools.keys()],
				renders,
				result,
				customResult,
				cancelResult,
				nonTui,
				callLines,
				resultLines,
			}));
		`;

		const child = spawnSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				childSource,
				pathToFileURL(path.join(pluginRoot, "index.ts")).href,
			],
			{ encoding: "utf8", timeout: 30_000 },
		);
		assert.equal(child.status, 0, child.stderr || child.stdout);
		const output = JSON.parse(child.stdout);
		assert.deepEqual(output.toolNames, ["ask_user_questions"]);
		assert.equal(output.renders[0].some((line) => line.includes("Ask User Questions")), true);
		assert.equal(output.renders[0].some((line) => line.includes("Recommended")), true);
		assert.equal(output.renders[1].some((line) => line.includes("Select one or more")), true);
		assert.equal(output.renders[2].some((line) => line.includes("Review your answers")), true);
		assert.equal(output.result.details.cancelled, false);
		assert.deepEqual(output.result.details.answers[0].choices.map((choice) => choice.label), ["Complete"]);
		assert.deepEqual(output.result.details.answers[1].choices.map((choice) => choice.label), ["Unit tests", "Smoke tests"]);
		assert.match(output.result.content[0].text, /checks \(Checks\): Unit tests; Smoke tests/);
		assert.deepEqual(output.customResult.details.answers[0].choices, [
			{ value: "A tailored scope", label: "A tailored scope", custom: true },
		]);
		assert.equal(output.cancelResult.details.cancelled, true);
		assert.match(output.cancelResult.content[0].text, /cancelled.*without answering/i);
		assert.equal(output.nonTui.isError, true);
		assert.match(output.nonTui.content[0].text, /interactive TUI mode is required/);
		assert.equal(output.callLines.some((line) => line.includes("2 questions")), true);
		assert.equal(output.resultLines.some((line) => line.includes("Complete")), true);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});
