import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ResponsesModel } from "./logic.ts";
import { compactEndpoint, extractRemoteSummary, isRemoteCompactionModel, replaceCompactionInput } from "./logic.ts";

function model(api: Api, id: string, name = id): Model<Api> {
	return {
		id,
		name,
		api,
		provider: "openai",
		baseUrl: "https://api.example.test/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	} as Model<Api>;
}

function responsesModel(api: ResponsesModel["api"], id: string): ResponsesModel {
	return model(api, id) as unknown as ResponsesModel;
}

test("routes Responses GPT models and excludes non-GPT APIs", () => {
	assert.equal(isRemoteCompactionModel(model("openai-responses", "gpt-5")), true);
	assert.equal(isRemoteCompactionModel(model("openai-codex-responses", "custom-codex", "GPT Codex")), true);
	assert.equal(isRemoteCompactionModel(model("openai-responses", "claude-3")), false);
	assert.equal(isRemoteCompactionModel(model("anthropic-messages", "gpt-proxy")), false);
});

test("builds the two compact endpoint forms", () => {
	assert.equal(
		compactEndpoint(responsesModel("openai-responses", "gpt-5")),
		"https://api.example.test/v1/responses/compact",
	);
	assert.equal(
		compactEndpoint(responsesModel("openai-codex-responses", "gpt-5"), "https://chatgpt.example.test/backend-api/"),
		"https://chatgpt.example.test/backend-api/codex/responses/compact",
	);
	assert.equal(
		compactEndpoint(
			responsesModel("openai-codex-responses", "gpt-5"),
			"https://chatgpt.example.test/backend-api/codex/responses",
		),
		"https://chatgpt.example.test/backend-api/codex/responses/compact",
	);
});

test("extracts readable assistant output and rejects opaque-only output", () => {
	assert.equal(
		extractRemoteSummary([
			{ type: "compaction", encrypted_content: "opaque" },
			{ type: "message", content: [{ type: "output_text", text: "Keep the API boundary." }] },
		]),
		"Keep the API boundary.",
	);
	assert.equal(extractRemoteSummary([{ type: "compaction", encrypted_content: "opaque" }]), "");
});

test("replaces only the Pi compaction summary item in a provider payload", () => {
	const payload = {
		model: "gpt-5",
		input: [
			{ role: "developer", content: "system" },
			{ role: "user", content: [{ type: "input_text", text: "old summary: Goal A" }] },
			{ role: "user", content: [{ type: "input_text", text: "live tail" }] },
		],
	};
	const rewritten = replaceCompactionInput(payload, "Goal A", [{ type: "compaction", encrypted_content: "opaque" }]);
	assert.deepEqual(rewritten, {
		model: "gpt-5",
		input: [
			{ role: "developer", content: "system" },
			{ type: "compaction", encrypted_content: "opaque" },
			{ role: "user", content: [{ type: "input_text", text: "live tail" }] },
		],
	});
});
