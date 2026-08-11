import assert from "node:assert/strict";
import test from "node:test";
import {
	COMMAND_USAGE,
	FastCommandError,
	FastState,
	getCommandCompletions,
	injectPriorityTier,
	isGptModel,
	parseFastCommand,
	readHandoff,
	writeHandoff,
} from "./logic.ts";

test("matches GPT in model id or display name, case-insensitively", () => {
	assert.equal(isGptModel({ id: "gpt-5.6", name: "GPT 5.6", provider: "openai" }), true);
	assert.equal(isGptModel({ id: "custom-fast", name: "GPT Proxy", provider: "proxy" }), true);
	assert.equal(isGptModel({ id: "claude-4", name: "Claude 4", provider: "anthropic" }), false);
	assert.equal(isGptModel(undefined), false);
});

test("keeps desired state while active follows the selected model", () => {
	const state = new FastState();
	state.setModel({ id: "gpt-5", name: "GPT-5" });
	state.setDesired(true);
	assert.equal(state.isDesired(), true);
	assert.equal(state.isActive(), true);
	state.setModel({ id: "claude-4", name: "Claude 4" });
	assert.equal(state.isDesired(), true);
	assert.equal(state.isActive(), false);
	state.setModel({ id: "gpt-5", name: "GPT-5" });
	assert.equal(state.isActive(), true);
});

test("injects priority without mutating the original payload", () => {
	const payload = { model: "gpt-5", input: [{ role: "user", content: "hi" }], service_tier: "default" };
	const rewritten = injectPriorityTier(payload);
	assert.notEqual(rewritten, payload);
	assert.deepEqual(rewritten, { ...payload, service_tier: "priority" });
	assert.equal(payload.service_tier, "default");
	const nonObject = ["not", "an", "object"];
	assert.equal(injectPriorityTier(nonObject), nonObject);
});

test("parses fast commands and completions", () => {
	assert.deepEqual(parseFastCommand(""), { kind: "toggle" });
	assert.deepEqual(parseFastCommand("on"), { kind: "set", desired: true });
	assert.deepEqual(parseFastCommand("OFF"), { kind: "set", desired: false });
	assert.deepEqual(parseFastCommand("status"), { kind: "status" });
	assert.deepEqual(getCommandCompletions("st"), [{ value: "status", label: "status — show current state" }]);
	assert.throws(() => parseFastCommand("priority"), (error: unknown) => {
		return error instanceof FastCommandError && error.message === COMMAND_USAGE;
	});
});

test("reads and writes the subagent handoff environment variable", () => {
	const env: Record<string, string | undefined> = {};
	assert.equal(readHandoff(env), undefined);
	writeHandoff(true, env);
	assert.equal(readHandoff(env), true);
	writeHandoff(false, env);
	assert.equal(readHandoff(env), false);
	env.PI_GPT_FAST_MODE = "unexpected";
	assert.equal(readHandoff(env), undefined);
});
