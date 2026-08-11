import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ResponsesModel } from "./logic.ts";
import { requestRemoteCompaction } from "./remote-request.ts";

function model(api: ResponsesModel["api"] = "openai-responses"): ResponsesModel {
	return {
		id: "gpt-5",
		name: "gpt-5",
		api,
		provider: "openai",
		baseUrl: "https://api.example.test/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	} as Model<Api> as ResponsesModel;
}

test("posts the compact request fields and returns the readable summary", async () => {
	let capturedUrl = "";
	let capturedBody: unknown;
	const fetchMock: typeof fetch = async (input, init) => {
		capturedUrl = String(input);
		capturedBody = JSON.parse(String(init?.body));
		return new Response(
			JSON.stringify({
				output: [
					{ type: "compaction", encrypted_content: "opaque" },
					{ type: "message", content: [{ type: "output_text", text: "summary" }] },
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	};
	const result = await requestRemoteCompaction(
		model("openai-codex-responses"),
		"compact carefully",
		[{ role: "user", content: [{ type: "input_text", text: "history" }] }],
		{ baseUrl: "https://api.example.test/backend-api", headers: new Headers({ authorization: "Bearer test" }) },
		{ reasoning: { effort: "high" }, service_tier: "priority" },
		new AbortController().signal,
		fetchMock,
	);
	assert.equal(capturedUrl, "https://api.example.test/backend-api/codex/responses/compact");
	assert.deepEqual(capturedBody, {
		model: "gpt-5",
		input: [{ role: "user", content: [{ type: "input_text", text: "history" }] }],
		instructions: "compact carefully",
		reasoning: { effort: "high" },
		service_tier: "priority",
		parallel_tool_calls: true,
	});
	assert.equal(result.summary, "summary");
	assert.equal(result.output.length, 2);
});

test("surfaces HTTP and malformed-response failures for the hook's native fallback", async () => {
	const auth = { baseUrl: "https://api.example.test/v1", headers: new Headers() };
	await assert.rejects(
		requestRemoteCompaction(
			model(),
			"instructions",
			[],
			auth,
			undefined,
			new AbortController().signal,
			async () => new Response("failed", { status: 503 }),
		),
		/HTTP 503/,
	);
	await assert.rejects(
		requestRemoteCompaction(
			model(),
			"instructions",
			[],
			auth,
			undefined,
			new AbortController().signal,
			async () => new Response(JSON.stringify({ output: [] }), { status: 200 }),
		),
		/no readable summary/,
	);
});
