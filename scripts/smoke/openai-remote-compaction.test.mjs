import assert from "node:assert/strict";
import {
	compactEndpoint,
	extractRemoteSummary,
	isRemoteCompactionModel,
} from "../../extensions/openai-remote-compaction/logic.ts";

const gptModel = {
	id: "gpt-5",
	name: "gpt-5",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.example.test/v1",
};

assert.equal(isRemoteCompactionModel(gptModel), true);
assert.equal(isRemoteCompactionModel({ ...gptModel, id: "claude-3", name: "claude-3" }), false);
assert.equal(compactEndpoint(gptModel), "https://api.example.test/v1/responses/compact");
assert.equal(
	extractRemoteSummary([
		{ type: "compaction", encrypted_content: "opaque" },
		{ type: "message", content: [{ type: "output_text", text: "summary" }] },
	]),
	"summary",
);
