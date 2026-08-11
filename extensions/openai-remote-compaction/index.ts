import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	convertToLlm,
	type ExtensionAPI,
	type ExtensionContext,
	getLatestCompactionEntry,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
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
import { requestRemoteCompaction, type ResolvedAuth } from "./remote-request.ts";
import { serializeResponsesInput } from "./responses-input.ts";

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
	return serializeResponsesInput(model, convertToLlm(messages));
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
