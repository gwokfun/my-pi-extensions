import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import {
	convertToLlm,
	type ExtensionAPI,
	type ExtensionContext,
	getLatestCompactionEntry,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	compactEndpoint,
	extractRemoteSummary,
	isRecord,
	isRemoteCompactionModel,
	isRemoteDetails,
	type JsonObject,
	normalizeBaseUrl,
	REMOTE_STRATEGY,
	type RemoteCompactionDetails,
	type ResponsesModel,
	replaceCompactionInput,
	sameModel,
} from "./logic.ts";

const COMPACT_TIMEOUT_MS = 120_000;
const REQUEST_FIELDS = [
	"tools",
	"parallel_tool_calls",
	"reasoning",
	"service_tier",
	"prompt_cache_key",
	"text",
] as const;

function latestRemoteCompaction(entries: SessionEntry[]): RemoteCompactionDetails | undefined {
	const latest = getLatestCompactionEntry(entries);
	return isRemoteDetails(latest?.details) ? latest.details : undefined;
}

function responseInputForMessages(model: ResponsesModel, messages: AgentMessage[]): unknown[] {
	const context: Context = { messages: convertToLlm(messages) };
	return convertResponsesMessages(model, context, new Set(["openai", "openai-codex", model.provider]), {
		includeSystemPrompt: false,
	});
}

function previousSummaryInput(summary: string): JsonObject {
	return {
		role: "user",
		content: [{ type: "input_text", text: `Previous Pi compaction summary:\n${summary}` }],
	};
}

function buildRemoteInput(
	model: ResponsesModel,
	preparation: { messagesToSummarize: AgentMessage[]; turnPrefixMessages: AgentMessage[]; previousSummary?: string },
	previousRemote: RemoteCompactionDetails | undefined,
	baseUrl: string,
): unknown[] {
	const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
	const serializedMessages = responseInputForMessages(model, messages);
	if (previousRemote && sameModel(previousRemote, model, baseUrl)) {
		return [...previousRemote.output, ...serializedMessages];
	}
	if (preparation.previousSummary) {
		return [previousSummaryInput(preparation.previousSummary), ...serializedMessages];
	}
	return serializedMessages;
}

function captureRequestFields(cache: Map<string, JsonObject>, sessionId: string, payload: unknown): void {
	if (!isRecord(payload)) return;
	const fields: JsonObject = {};
	for (const field of REQUEST_FIELDS) {
		if (field in payload) fields[field] = payload[field];
	}
	cache.set(sessionId, fields);
}

type ResolvedAuth = { baseUrl: string; headers: Headers };

async function resolveAuth(ctx: ExtensionContext, model: ResponsesModel): Promise<ResolvedAuth> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);

	const headers = new Headers();
	for (const [name, value] of Object.entries(auth.headers ?? {})) {
		if (value !== null) headers.set(name, value);
	}
	if (auth.apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${auth.apiKey}`);
	headers.set("content-type", "application/json");
	if (model.api === "openai-codex-responses") {
		headers.set("originator", headers.get("originator") ?? "pi");
		headers.set("openai-beta", headers.get("openai-beta") ?? "responses=experimental");
	}

	return { baseUrl: normalizeBaseUrl(auth.baseUrl ?? model.baseUrl), headers };
}

async function requestRemoteCompaction(
	model: ResponsesModel,
	instructions: string,
	input: unknown[],
	auth: ResolvedAuth,
	requestFields: JsonObject | undefined,
	signal: AbortSignal,
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
	const response = await fetch(compactEndpoint(model, auth.baseUrl), {
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

function notifyFallback(ctx: ExtensionContext, error: unknown): void {
	if (ctx.hasUI) {
		const reason = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`远程压缩失败，已回退到 Pi 原生压缩${reason ? `：${reason}` : ""}`, "warning");
	}
}

export default function (pi: ExtensionAPI): void {
	const requestFields = new Map<string, JsonObject>();

	pi.on("before_provider_request", (event, ctx) => {
		const model = ctx.model;
		if (!isRemoteCompactionModel(model)) return;
		captureRequestFields(requestFields, ctx.sessionManager.getSessionId(), event.payload);

		const latest = getLatestCompactionEntry(ctx.sessionManager.getBranch());
		if (!latest || !isRemoteDetails(latest.details)) return;
		const baseUrl = normalizeBaseUrl(model.baseUrl);
		if (!sameModel(latest.details, model, baseUrl)) return;

		return replaceCompactionInput(event.payload, latest.summary, latest.details.output);
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const model = ctx.model;
		if (!isRemoteCompactionModel(model)) return;
		if (event.signal.aborted) return { cancel: true };

		try {
			const auth = await resolveAuth(ctx, model);
			const previousRemote = latestRemoteCompaction(event.branchEntries);
			const input = buildRemoteInput(model, event.preparation, previousRemote, auth.baseUrl);
			const result = await requestRemoteCompaction(
				model,
				ctx.getSystemPrompt(),
				input,
				auth,
				requestFields.get(ctx.sessionManager.getSessionId()),
				event.signal,
			);

			const details: RemoteCompactionDetails = {
				strategy: REMOTE_STRATEGY,
				provider: model.provider,
				api: model.api,
				baseUrl: auth.baseUrl,
				modelId: model.id,
				output: result.output,
			};
			return {
				compaction: {
					summary: result.summary,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					details,
				},
			};
		} catch (error) {
			if (event.signal.aborted) return { cancel: true };
			notifyFallback(ctx, error);
			return;
		}
	});
}
