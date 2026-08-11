import type {
	Api,
	AssistantMessage,
	ImageContent,
	Message,
	Model,
	TextContent,
	TextSignatureV1,
	ToolCall,
} from "@earendil-works/pi-ai";

type JsonObject = Record<string, unknown>;

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function shortHash(value: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let index = 0; index < value.length; index++) {
		const character = value.charCodeAt(index);
		h1 = Math.imul(h1 ^ character, 2654435761);
		h2 = Math.imul(h2 ^ character, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function parseTextSignature(
	signature: string | undefined,
): { id: string; phase?: TextSignatureV1["phase"] } | undefined {
	if (!signature) return undefined;
	if (signature.startsWith("{")) {
		try {
			const parsed = JSON.parse(signature) as Partial<TextSignatureV1>;
			if (parsed.v === 1 && typeof parsed.id === "string") {
				if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
					return { id: parsed.id, phase: parsed.phase };
				}
				return { id: parsed.id };
			}
		} catch {
			// Preserve the legacy behavior: malformed JSON-shaped signatures are plain IDs.
		}
	}
	return { id: signature };
}

function normalizeIdPart(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");
	const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
	return normalized.replace(/_+$/, "");
}

function normalizeToolCallId<TApi extends Api>(id: string, model: Model<TApi>, source: AssistantMessage): string {
	if (!id.includes("|")) return normalizeIdPart(id);
	const [callId, itemId] = id.split("|");
	const normalizedCallId = normalizeIdPart(callId);
	const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;
	let normalizedItemId = isForeignToolCall ? `fc_${shortHash(itemId)}` : normalizeIdPart(itemId);
	if (!normalizedItemId.startsWith("fc_")) normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
	return `${normalizedCallId}|${normalizedItemId}`;
}

function replaceImagesWithPlaceholder(
	content: readonly (TextContent | ImageContent)[],
	placeholder: string,
): TextContent[] {
	const result: TextContent[] = [];
	let previousWasPlaceholder = false;
	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) result.push({ type: "text", text: placeholder });
			previousWasPlaceholder = true;
			continue;
		}
		if (block.type !== "text") {
			throw new Error(`Unsupported message content block: ${(block as { type?: unknown }).type}`);
		}
		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}
	return result;
}

function validateMessageContent(content: readonly (TextContent | ImageContent)[]): void {
	for (const block of content) {
		if (block.type !== "text" && block.type !== "image") {
			throw new Error(`Unsupported message content block: ${(block as { type?: unknown }).type}`);
		}
	}
}

function normalizeMessages<TApi extends Api>(messages: Message[], model: Model<TApi>): Message[] {
	const toolCallIdMap = new Map<string, string>();
	const transformed = messages.map((rawMessage): Message => {
		const message = rawMessage.content == null ? ({ ...rawMessage, content: [] } as Message) : rawMessage;
		if (message.role === "user") {
			if (Array.isArray(message.content)) validateMessageContent(message.content);
			if (!model.input.includes("image") && Array.isArray(message.content)) {
				return {
					...message,
					content: replaceImagesWithPlaceholder(message.content, NON_VISION_USER_IMAGE_PLACEHOLDER),
				};
			}
			return message;
		}
		if (message.role === "toolResult") {
			validateMessageContent(message.content);
			const normalizedId = toolCallIdMap.get(message.toolCallId);
			return {
				...message,
				toolCallId: normalizedId ?? message.toolCallId,
				content: model.input.includes("image")
					? message.content
					: replaceImagesWithPlaceholder(message.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER),
			};
		}
		if (message.role !== "assistant") throw new Error(`Unsupported message role: ${(message as { role?: unknown }).role}`);

		const isSameModel =
			message.provider === model.provider && message.api === model.api && message.model === model.id;
		const content = message.content.flatMap((block) => {
			if (block.type === "thinking") {
				if (block.redacted) return isSameModel ? [block] : [];
				if (isSameModel && block.thinkingSignature) return [block];
				if (!block.thinking || block.thinking.trim() === "") return [];
				return isSameModel ? [block] : [{ type: "text" as const, text: block.thinking }];
			}
			if (block.type === "text") {
				return isSameModel ? [block] : [{ type: "text" as const, text: block.text }];
			}
			if (block.type === "toolCall") {
				let normalized: ToolCall = block;
				if (!isSameModel && block.thoughtSignature) {
					normalized = { ...normalized };
					delete normalized.thoughtSignature;
				}
				if (!isSameModel) {
					const normalizedId = normalizeToolCallId(block.id, model, message);
					if (normalizedId !== block.id) {
						toolCallIdMap.set(block.id, normalizedId);
						normalized = { ...normalized, id: normalizedId };
					}
				}
				return [normalized];
			}
			throw new Error(`Unsupported assistant content block: ${(block as { type?: unknown }).type}`);
		});
		return { ...message, content };
	});

	const result: Message[] = [];
	let pendingToolCalls: ToolCall[] = [];
	let existingToolResultIds = new Set<string>();
	const insertSyntheticToolResults = () => {
		for (const toolCall of pendingToolCalls) {
			if (existingToolResultIds.has(toolCall.id)) continue;
			result.push({
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: [{ type: "text", text: "No result provided" }],
				isError: true,
				timestamp: Date.now(),
			});
		}
		pendingToolCalls = [];
		existingToolResultIds = new Set();
	};

	for (const message of transformed) {
		if (message.role === "assistant") {
			insertSyntheticToolResults();
			if (message.stopReason === "error" || message.stopReason === "aborted") continue;
			pendingToolCalls = message.content.filter((block): block is ToolCall => block.type === "toolCall");
			result.push(message);
			continue;
		}
		if (message.role === "toolResult") {
			existingToolResultIds.add(message.toolCallId);
			result.push(message);
			continue;
		}
		insertSyntheticToolResults();
		result.push(message);
	}
	insertSyntheticToolResults();
	return result;
}

function parseReasoningItem(signature: string): JsonObject {
	const parsed: unknown = JSON.parse(signature);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || (parsed as JsonObject).type !== "reasoning") {
		throw new Error("Invalid OpenAI reasoning signature");
	}
	return parsed as JsonObject;
}

function convertToolResultOutput<TApi extends Api>(
	model: Model<TApi>,
	content: readonly (TextContent | ImageContent)[],
): string | JsonObject[] {
	const text = content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	const images = content.filter((block): block is ImageContent => block.type === "image");
	if (images.length === 0 || !model.input.includes("image")) {
		return sanitizeSurrogates(text || (images.length > 0 ? "(see attached image)" : "(no tool output)"));
	}
	const output: JsonObject[] = [];
	if (text) output.push({ type: "input_text", text: sanitizeSurrogates(text) });
	for (const image of images) {
		output.push({
			type: "input_image",
			detail: "auto",
			image_url: `data:${image.mimeType};base64,${image.data}`,
		});
	}
	return output;
}

export function serializeResponsesInput<TApi extends Api>(model: Model<TApi>, inputMessages: Message[]): JsonObject[] {
	const output: JsonObject[] = [];
	let messageIndex = 0;
	for (const message of normalizeMessages(inputMessages, model)) {
		if (message.role === "user") {
			const content =
				typeof message.content === "string"
					? [{ type: "input_text", text: sanitizeSurrogates(message.content) }]
					: message.content.map((block) =>
							block.type === "text"
								? { type: "input_text", text: sanitizeSurrogates(block.text) }
								: {
										type: "input_image",
										detail: "auto",
										image_url: `data:${block.mimeType};base64,${block.data}`,
									},
						);
			if (content.length === 0) continue;
			output.push({ role: "user", content });
		} else if (message.role === "assistant") {
			const isSameProviderAndApi = message.provider === model.provider && message.api === model.api;
			const isSameModel = isSameProviderAndApi && message.model === model.id;
			const isDifferentModel = isSameProviderAndApi && message.model !== model.id;
			const items: JsonObject[] = [];
			let textBlockIndex = 0;
			for (const block of message.content) {
				if (block.type === "thinking") {
					if (block.thinkingSignature) items.push(parseReasoningItem(block.thinkingSignature));
					continue;
				}
				if (block.type === "text") {
					const signature = parseTextSignature(block.textSignature);
					const fallbackId = textBlockIndex === 0 ? `msg_pi_${messageIndex}` : `msg_pi_${messageIndex}_${textBlockIndex}`;
					textBlockIndex++;
					const id = !signature?.id ? fallbackId : signature.id.length > 64 ? `msg_${shortHash(signature.id)}` : signature.id;
					items.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: sanitizeSurrogates(block.text), annotations: [] }],
						status: "completed",
						id,
						...(signature?.phase ? { phase: signature.phase } : {}),
					});
					continue;
				}
				if (block.type === "toolCall") {
					const [callId, rawItemId] = block.id.split("|");
					let itemId = rawItemId;
					if ((isDifferentModel && itemId?.startsWith("fc_")) || !itemId?.startsWith("fc_")) itemId = undefined;
					items.push({
						type: "function_call",
						...(itemId ? { id: itemId } : {}),
						call_id: callId,
						name: block.name,
						arguments: JSON.stringify(block.arguments),
						...(isSameModel && block.namespace !== undefined ? { namespace: block.namespace } : {}),
					});
					continue;
				}
				throw new Error(`Unsupported assistant content block: ${(block as { type?: unknown }).type}`);
			}
			if (items.length === 0) continue;
			output.push(...items);
		} else if (message.role === "toolResult") {
			const [callId] = message.toolCallId.split("|");
			output.push({
				type: "function_call_output",
				call_id: callId,
				output: convertToolResultOutput(model, message.content),
			});
		} else {
			throw new Error(`Unsupported message role: ${(message as { role?: unknown }).role}`);
		}
		messageIndex++;
	}
	return output;
}
