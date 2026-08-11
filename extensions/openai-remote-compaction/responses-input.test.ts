import assert from "node:assert/strict";
import test from "node:test";
import type { Api, AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import { serializeResponsesInput } from "./responses-input.ts";

function model(input: Model<Api>["input"] = ["text"], id = "gpt-5"): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://api.example.test/v1",
		reasoning: true,
		input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	} as Model<Api>;
}

function assistant(content: AssistantMessage["content"], overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
		stopReason: "stop",
		timestamp: 1,
		...overrides,
	} as AssistantMessage;
}

test("serializes user text, sanitizes surrogates, and downgrades unsupported images", () => {
	const messages: Message[] = [
		{
			role: "user",
			content: [
				{ type: "text", text: `hello${String.fromCharCode(0xd83d)}` },
				{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
				{ type: "image", mimeType: "image/png", data: "aW1hZ2Uy" },
			],
			timestamp: 1,
		},
	];
	assert.deepEqual(serializeResponsesInput(model(), messages), [
		{
			role: "user",
			content: [
				{ type: "input_text", text: "hello" },
				{ type: "input_text", text: "(image omitted: model does not support images)" },
			],
		},
	]);
});

test("preserves same-model reasoning, message metadata, tool IDs, namespace, and results", () => {
	const messages: Message[] = [
		assistant([
			{ type: "thinking", thinking: "", thinkingSignature: '{"type":"reasoning","id":"rs_1","encrypted_content":"opaque"}' },
			{
				type: "text",
				text: "done",
				textSignature: '{"v":1,"id":"msg_1","phase":"final_answer"}',
			},
			{ type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a" }, namespace: "workspace" },
		]),
		{
			role: "toolResult",
			toolCallId: "call_1|fc_1",
			toolName: "read",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: 2,
		},
	];
	assert.deepEqual(serializeResponsesInput(model(), messages), [
		{ type: "reasoning", id: "rs_1", encrypted_content: "opaque" },
		{
			type: "message",
			role: "assistant",
			content: [{ type: "output_text", text: "done", annotations: [] }],
			status: "completed",
			id: "msg_1",
			phase: "final_answer",
		},
		{
			type: "function_call",
			id: "fc_1",
			call_id: "call_1",
			name: "read",
			arguments: '{"path":"a"}',
			namespace: "workspace",
		},
		{ type: "function_call_output", call_id: "call_1", output: "ok" },
	]);
});

test("downgrades foreign reasoning and normalizes foreign tool IDs without replaying namespace", () => {
	const messages: Message[] = [
		assistant(
			[
				{ type: "thinking", thinking: "visible thought", thinkingSignature: "not-json" },
				{ type: "text", text: "answer", textSignature: "foreign-message-id" },
				{
					type: "toolCall",
					id: "bad call|foreign item",
					name: "search",
					arguments: { q: "x" },
					namespace: "foreign",
					thoughtSignature: "foreign-thought",
				},
			],
			{ provider: "other", api: "anthropic-messages", model: "other-model" },
		),
		{
			role: "toolResult",
			toolCallId: "bad call|foreign item",
			toolName: "search",
			content: [{ type: "text", text: "result" }],
			isError: false,
			timestamp: 2,
		},
	];
	const output = serializeResponsesInput(model(), messages);
	assert.equal(output[0].type, "message");
	assert.deepEqual(output[0].content, [{ type: "output_text", text: "visible thought", annotations: [] }]);
	assert.equal(output[1].id, "msg_pi_0_1");
	assert.equal(output[2].type, "function_call");
	assert.equal(output[2].call_id, "bad_call");
	assert.match(String(output[2].id), /^fc_[a-z0-9]+$/);
	assert.equal("namespace" in output[2], false);
	assert.equal(output[3].call_id, "bad_call");
});

test("drops same-provider IDs when replaying a different model", () => {
	const output = serializeResponsesInput(
		model(),
		[assistant([{ type: "toolCall", id: "call_1|fc_1", name: "read", arguments: {} }], { model: "gpt-4.1" })],
	);
	assert.deepEqual(output[0], {
		type: "function_call",
		call_id: "call_1",
		name: "read",
		arguments: "{}",
	});
	assert.deepEqual(output[1], {
		type: "function_call_output",
		call_id: "call_1",
		output: "No result provided",
	});
});

test("skips aborted assistant messages and synthesizes missing tool outputs", () => {
	const output = serializeResponsesInput(model(), [
		assistant([{ type: "text", text: "partial" }], { stopReason: "aborted" }),
		assistant([{ type: "toolCall", id: "call_2|fc_2", name: "write", arguments: {} }]),
	]);
	assert.equal(output.some((item) => JSON.stringify(item).includes("partial")), false);
	assert.deepEqual(output.at(-1), {
		type: "function_call_output",
		call_id: "call_2",
		output: "No result provided",
	});
});

test("preserves tool images only for vision models", () => {
	const messages: Message[] = [
		{
			role: "toolResult",
			toolCallId: "call_image",
			toolName: "view",
			content: [
				{ type: "text", text: "caption" },
				{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
			],
			isError: false,
			timestamp: 1,
		},
	];
	assert.deepEqual(serializeResponsesInput(model(["text", "image"]), messages), [
		{
			type: "function_call_output",
			call_id: "call_image",
			output: [
				{ type: "input_text", text: "caption" },
				{ type: "input_image", detail: "auto", image_url: "data:image/png;base64,aW1hZ2U=" },
			],
		},
	]);
});

test("fails closed on an invalid same-model reasoning signature", () => {
	assert.throws(
		() => serializeResponsesInput(model(), [assistant([{ type: "thinking", thinking: "", thinkingSignature: "bad" }])]),
		/Unexpected token|JSON/,
	);
});

test("fails closed on an unknown user content block", () => {
	const messages = [
		{ role: "user", content: [{ type: "future-content", value: "x" }], timestamp: 1 },
	] as unknown as Message[];
	assert.throws(() => serializeResponsesInput(model(["text", "image"]), messages), /Unsupported message content block/);
});
