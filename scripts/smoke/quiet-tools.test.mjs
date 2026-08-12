import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("quiet-tools delegates built-ins and stays safe outside a TUI", async () => {
	const registrations = [];
	const handlers = new Map();
	const module = await import(path.join(root, "extensions/quiet-tools/index.ts"));
	module.default({
		registerTool(tool) { registrations.push(tool); },
		registerShortcut() {},
		on(name, handler) { handlers.set(name, handler); },
	});
	assert.deepEqual(registrations.map((tool) => tool.name), ["read", "bash", "edit", "write", "find", "grep", "ls"]);
	assert.ok(registrations.every((tool) => typeof tool.execute === "function" && tool.description && tool.parameters));
	assert.ok(registrations.every((tool) => tool.renderShell === "self"), "compact tools must bypass Pi's colored Box shell");
	let label = "";
	assert.doesNotThrow(() => handlers.get("session_start")({}, { ui: { setHiddenThinkingLabel(value) { label = value; } } }));
	assert.match(label, /thinking hidden/);
	const source = readFileSync(path.join(root, "extensions/quiet-tools/index.ts"), "utf8");
	assert.doesNotMatch(source, /registerTool\(\s*\{[^}]*name:\s*["']web_search/s);
});
