import type { Api, Model } from "@earendil-works/pi-ai";

export type JsonObject = Record<string, unknown>;
export type ResponsesModel = Model<"openai-responses" | "openai-codex-responses">;

export const REMOTE_STRATEGY = "openai-remote-v1" as const;

export interface RemoteCompactionDetails {
	strategy: typeof REMOTE_STRATEGY;
	provider: string;
	api: "openai-responses" | "openai-codex-responses";
	baseUrl: string;
	modelId: string;
	output: unknown[];
}

export function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, "");
}

export function isRemoteCompactionModel(model: Model<Api> | undefined): model is ResponsesModel {
	if (!model) return false;
	return (
		(model.api === "openai-responses" || model.api === "openai-codex-responses") &&
		/gpt/i.test(`${model.id} ${model.name}`)
	);
}

export function compactEndpoint(model: ResponsesModel, baseUrl = model.baseUrl): string {
	const normalized = normalizeBaseUrl(baseUrl);
	if (model.api === "openai-codex-responses") {
		if (normalized.endsWith("/codex/responses")) return `${normalized}/compact`;
		if (normalized.endsWith("/codex")) return `${normalized}/responses/compact`;
		return `${normalized}/codex/responses/compact`;
	}
	if (normalized.endsWith("/responses")) return `${normalized}/compact`;
	return `${normalized}/responses/compact`;
}

export function sameModel(details: RemoteCompactionDetails, model: ResponsesModel, baseUrl: string): boolean {
	return (
		details.provider === model.provider &&
		details.api === model.api &&
		details.modelId === model.id &&
		normalizeBaseUrl(details.baseUrl) === normalizeBaseUrl(baseUrl)
	);
}

export function isRemoteDetails(value: unknown): value is RemoteCompactionDetails {
	return (
		isRecord(value) &&
		value.strategy === REMOTE_STRATEGY &&
		typeof value.provider === "string" &&
		(value.api === "openai-responses" || value.api === "openai-codex-responses") &&
		typeof value.baseUrl === "string" &&
		typeof value.modelId === "string" &&
		Array.isArray(value.output)
	);
}

function collectText(value: unknown, output: string[]): void {
	if (!isRecord(value)) return;
	if (value.type === "message" && Array.isArray(value.content)) {
		for (const block of value.content) {
			if (!isRecord(block)) continue;
			if (
				(block.type === "output_text" || block.type === "text" || block.type === "refusal") &&
				typeof block.text === "string"
			) {
				output.push(block.text);
			}
		}
	}
	if (value.type === "output_text" && typeof value.text === "string") output.push(value.text);
	if (Array.isArray(value.summary)) {
		for (const item of value.summary) {
			if (isRecord(item) && typeof item.text === "string") output.push(item.text);
		}
	}
}

export function extractRemoteSummary(output: unknown[]): string {
	const text: string[] = [];
	for (const item of output) collectText(item, text);
	return text.join("\n\n").trim();
}

function containsSummary(value: unknown, summary: string): boolean {
	if (typeof value === "string") return value.includes(summary);
	if (Array.isArray(value)) return value.some((item) => containsSummary(item, summary));
	if (!isRecord(value)) return false;
	return Object.values(value).some((item) => containsSummary(item, summary));
}

export function replaceCompactionInput(payload: unknown, summary: string, output: unknown[]): unknown {
	if (!isRecord(payload) || !Array.isArray(payload.input) || !summary) return undefined;
	const index = payload.input.findIndex((item) => containsSummary(item, summary));
	if (index < 0) return undefined;
	return {
		...payload,
		input: [...payload.input.slice(0, index), ...output, ...payload.input.slice(index + 1)],
	};
}
