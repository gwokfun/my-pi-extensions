import {
	compactEndpoint,
	extractRemoteSummary,
	isRecord,
	type JsonObject,
	type ResponsesModel,
} from "./logic.ts";

const COMPACT_TIMEOUT_MS = 120_000;

export type ResolvedAuth = { baseUrl: string; headers: Headers };

export async function requestRemoteCompaction(
	model: ResponsesModel,
	instructions: string,
	input: unknown[],
	auth: ResolvedAuth,
	requestFields: JsonObject | undefined,
	signal: AbortSignal,
	fetchImplementation: typeof fetch = fetch,
): Promise<{ output: unknown[]; summary: string }> {
	const fields = { ...(requestFields ?? {}) };
	if (model.api === "openai-codex-responses" && typeof fields.parallel_tool_calls !== "boolean") {
		fields.parallel_tool_calls = true;
	}
	const body: JsonObject = {
		model: model.id,
		input,
		instructions,
		...fields,
	};
	const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(COMPACT_TIMEOUT_MS)]);
	const response = await fetchImplementation(compactEndpoint(model, auth.baseUrl), {
		method: "POST",
		headers: auth.headers,
		body: JSON.stringify(body),
		signal: requestSignal,
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);

	const parsed: unknown = await response.json();
	if (!isRecord(parsed) || !Array.isArray(parsed.output)) throw new Error("Invalid compact response");
	const summary = extractRemoteSummary(parsed.output);
	if (!summary) throw new Error("Compact response has no readable summary");
	return { output: parsed.output, summary };
}
