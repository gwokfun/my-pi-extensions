import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import extension from "../../extensions/gpt-fast-mode/index.ts";

const hooks = new Map();
const commands = new Map();
const flags = new Map();
const flagValues = new Map();

const pi = {
	registerFlag(name, options) {
		flags.set(name, options);
	},
	getFlag(name) {
		return flagValues.get(name);
	},
	registerCommand(name, options) {
		commands.set(name, options);
	},
	on(name, handler) {
		const handlers = hooks.get(name) ?? [];
		handlers.push(handler);
		hooks.set(name, handlers);
	},
};

const statuses = new Map();
const notifications = [];
const ui = {
	setStatus(key, value) {
		statuses.set(key, value);
	},
	notify(message, level) {
		notifications.push({ message, level });
	},
};

const runHook = async (name, event, ctx) => {
	let result;
	for (const handler of hooks.get(name) ?? []) {
		const next = await handler(event, ctx);
		if (next !== undefined) result = next;
	}
	return result;
};

const oldHandoff = process.env.PI_GPT_FAST_MODE;
delete process.env.PI_GPT_FAST_MODE;

try {
	extension(pi);
	assert.equal(flags.has("fast"), true);
	assert.equal(commands.has("fast"), true);
	assert.equal(hooks.has("before_provider_request"), true);

	flagValues.set("fast", true);
	const gptContext = {
		model: { id: "gpt-5.6", name: "GPT-5.6", provider: "openai" },
		hasUI: true,
		ui,
	};
	await runHook("session_start", { reason: "startup" }, gptContext);
	assert.equal(process.env.PI_GPT_FAST_MODE, "1");
	assert.equal(statuses.get("gpt-fast-mode"), "fast");
	await commands.get("fast").handler("off", gptContext);
	assert.equal(process.env.PI_GPT_FAST_MODE, "0");
	assert.equal(statuses.get("gpt-fast-mode"), undefined);
	await commands.get("fast").handler("on", gptContext);
	assert.equal(process.env.PI_GPT_FAST_MODE, "1");
	assert.equal(statuses.get("gpt-fast-mode"), "fast");
	const child = spawnSync(process.execPath, ["-e", "process.stdout.write(process.env.PI_GPT_FAST_MODE ?? '')"], {
		env: process.env,
		encoding: "utf8",
	});
	assert.equal(child.status, 0);
	assert.equal(child.stdout, "1");

	const rewritten = await runHook(
		"before_provider_request",
		{ payload: { model: "gpt-5.6", input: [] } },
		gptContext,
	);
	assert.deepEqual(rewritten, { model: "gpt-5.6", input: [], service_tier: "priority" });

	const claudeContext = {
		...gptContext,
		model: { id: "claude-4", name: "Claude 4", provider: "anthropic" },
	};
	await runHook("model_select", { model: claudeContext.model }, claudeContext);
	assert.equal(statuses.get("gpt-fast-mode"), "fast⇢");
	assert.equal(
		await runHook("before_provider_request", { payload: { model: "claude-4" } }, claudeContext),
		undefined,
	);

	await commands.get("fast").handler("off", claudeContext);
	assert.equal(process.env.PI_GPT_FAST_MODE, "0");
	assert.equal(statuses.get("gpt-fast-mode"), undefined);
} finally {
	if (oldHandoff === undefined) delete process.env.PI_GPT_FAST_MODE;
	else process.env.PI_GPT_FAST_MODE = oldHandoff;
}
