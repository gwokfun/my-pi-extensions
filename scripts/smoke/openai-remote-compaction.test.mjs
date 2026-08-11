import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	compactEndpoint,
	extractRemoteSummary,
	isRemoteCompactionModel,
} from "../../extensions/openai-remote-compaction/logic.ts";
import { serializeResponsesInput } from "../../extensions/openai-remote-compaction/responses-input.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const extensionSource = await readFile(
	resolve(packageRoot, "extensions/openai-remote-compaction/index.ts"),
	"utf8",
);

assert.doesNotMatch(extensionSource, /@earendil-works\/pi-[^"']+\/(?:api|dist|src)\//);

const gptModel = {
	id: "gpt-5",
	name: "gpt-5",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.example.test/v1",
	input: ["text"],
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

assert.deepEqual(
	serializeResponsesInput(gptModel, [{ role: "user", content: "startup smoke", timestamp: 1 }]),
	[{ role: "user", content: [{ type: "input_text", text: "startup smoke" }] }],
);
