export type GrokBlockKind = "user" | "assistant" | "thinking" | "tool";
export type GrokBlockStatus = "streaming" | "pending" | "completed" | "error" | "cancelled" | "incomplete";

export interface GrokBlock {
	id: string;
	kind: GrokBlockKind;
	status: GrokBlockStatus;
	summary: string;
	body: string;
	command?: string;
	toolName?: string;
	toolCallId?: string;
	args?: unknown;
	startedAt?: number;
	endedAt?: number;
	errorMessage?: string;
	exitCode?: number;
	expanded: boolean;
	manualExpansion: boolean;
	selectable: boolean;
}

export interface GrokState {
	blocks: GrokBlock[];
	selectedIndex: number;
	thinkingGloballyExpanded: boolean;
	toolsGloballyExpanded: boolean;
	activeTurn?: number;
	lastEventAt: number;
}

export interface SessionEntryLike {
	type?: string;
	id?: string;
	message?: AgentMessageLike;
	data?: unknown;
}

export interface AgentMessageLike {
	id?: string;
	role?: string;
	timestamp?: number;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	stopReason?: string;
	errorMessage?: string;
}

export interface GrokEventLike {
	type: string;
	turnIndex?: number;
	timestamp?: number;
	message?: AgentMessageLike;
	assistantMessageEvent?: unknown;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	partialResult?: unknown;
	result?: unknown;
	isError?: boolean;
}

const BLOCK_KINDS: readonly GrokBlockKind[] = ["user", "assistant", "thinking", "tool"];

function now(): number {
	return Date.now();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function compactWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function contentItems(message: AgentMessageLike): unknown[] {
	if (Array.isArray(message.content)) return message.content;
	return message.content === undefined ? [] : [message.content];
}

function itemType(item: unknown): string {
	return stringValue(asRecord(item)?.type) ?? "text";
}

function itemText(item: unknown): string {
	if (typeof item === "string") return item;
	const record = asRecord(item);
	if (!record) return "";
	for (const key of ["text", "thinking", "output", "stdout", "stderr", "content"]) {
		const value = record[key];
		if (typeof value === "string") return value;
		if (Array.isArray(value)) return value.map(itemText).filter(Boolean).join("\n");
	}
	return "";
}

export function displayText(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join("\n");
	const record = asRecord(value);
	if (!record) return String(value);
	for (const key of ["content", "output", "stdout", "stderr", "text", "message"]) {
		if (record[key] !== undefined) {
			const text = displayText(record[key]);
			if (text) return text;
		}
	}
	return safeJson(value);
}

function toolCommand(toolName: string, args: unknown): string {
	const record = asRecord(args);
	if (toolName === "bash" && typeof record?.command === "string") return record.command;
	if (toolName === "shell" && typeof record?.command === "string") return record.command;
	if (typeof record?.command === "string") return record.command;
	const json = safeJson(args);
	return json === undefined ? toolName : `${toolName} ${json}`;
}

function statusForMessage(message: AgentMessageLike): GrokBlockStatus {
	if (message.isError || message.stopReason === "error") return "error";
	if (message.stopReason === "aborted") return "cancelled";
	return "completed";
}

function defaultExpanded(kind: GrokBlockKind, status: GrokBlockStatus, state: GrokState): boolean {
	if (status === "streaming" || status === "pending") return true;
	if (kind === "thinking") return state.thinkingGloballyExpanded;
	if (kind === "tool") return status === "error" ? true : state.toolsGloballyExpanded;
	return true;
}

function makeBlock(
	state: GrokState,
	input: Pick<GrokBlock, "id" | "kind" | "summary" | "body"> & Partial<GrokBlock>,
): GrokBlock {
	const status = input.status ?? "completed";
	return {
		id: input.id,
		kind: input.kind,
		status,
		summary: input.summary,
		body: input.body,
		command: input.command,
		toolName: input.toolName,
		toolCallId: input.toolCallId,
		args: input.args,
		startedAt: input.startedAt,
		endedAt: input.endedAt,
		errorMessage: input.errorMessage,
		exitCode: input.exitCode,
		expanded: input.expanded ?? defaultExpanded(input.kind, status, state),
		manualExpansion: input.manualExpansion ?? false,
		selectable: input.selectable ?? true,
	};
}

export function createGrokState(): GrokState {
	return {
		blocks: [],
		selectedIndex: 0,
		thinkingGloballyExpanded: false,
		toolsGloballyExpanded: false,
		lastEventAt: now(),
	};
}

function blockIdForMessage(message: AgentMessageLike, index: number, kind: GrokBlockKind): string {
	const identity = message.id ?? message.timestamp ?? "live";
	return `${kind}-${identity}-${index}`;
}

function findBlock(state: GrokState, id: string): GrokBlock | undefined {
	return state.blocks.find((block) => block.id === id);
}

function findTool(state: GrokState, toolCallId: string): GrokBlock | undefined {
	return state.blocks.find((block) => block.kind === "tool" && block.toolCallId === toolCallId);
}

function appendBlock(state: GrokState, block: GrokBlock): GrokBlock {
	const existing = findBlock(state, block.id);
	if (existing) return existing;
	state.blocks.push(block);
	state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, state.blocks.length - 1));
	return block;
}

function upsertMessageBlocks(state: GrokState, message: AgentMessageLike, status: GrokBlockStatus): void {
	const role = message.role;
	if (role === "user") {
		const body = displayText(message.content);
		if (!body) return;
		appendBlock(
			state,
			makeBlock(state, {
				id: blockIdForMessage(message, 0, "user"),
				kind: "user",
				summary: compactWhitespace(body).slice(0, 120),
				body,
				status: "completed",
			}),
		);
		return;
	}

	if (role !== "assistant") return;
	contentItems(message).forEach((item, index) => {
		const type = itemType(item);
		const record = asRecord(item);
		if (type === "thinking" || type === "reasoning") {
			const body = itemText(item);
			const id = blockIdForMessage(message, index, "thinking");
			const existing = findBlock(state, id);
			if (existing) {
				existing.body = body;
				existing.summary = `Thought${status === "completed" ? "" : " (streaming)"}`;
				if (!existing.manualExpansion) existing.expanded = defaultExpanded("thinking", status, state);
				existing.status = status;
			} else {
				appendBlock(
					state,
					makeBlock(state, {
						id,
						kind: "thinking",
						summary: `Thought${status === "completed" ? "" : " (streaming)"}`,
						body,
						status,
						startedAt: message.timestamp,
					}),
				);
			}
			return;
		}
		if (type === "toolCall" || type === "tool_call") {
			const toolCallId = stringValue(record?.id) ?? stringValue(record?.toolCallId) ?? `${message.timestamp ?? "live"}-${index}`;
			const toolName = stringValue(record?.name) ?? stringValue(record?.toolName) ?? "tool";
			const args = record?.arguments ?? record?.args;
			const command = toolCommand(toolName, args);
			const existing = findTool(state, toolCallId);
			if (existing) {
				existing.toolName = toolName;
				existing.args = args;
				existing.command = command;
				existing.summary = `${toolName}: ${compactWhitespace(command).slice(0, 100)}`;
			} else {
				appendBlock(
					state,
					makeBlock(state, {
						id: `tool-${toolCallId}`,
						kind: "tool",
						summary: `${toolName}: ${compactWhitespace(command).slice(0, 100)}`,
						body: command,
						command,
						toolName,
						toolCallId,
						args,
						status: "pending",
						startedAt: message.timestamp,
					}),
				);
			}
			return;
		}
		const body = itemText(item);
		if (!body) return;
		const id = blockIdForMessage(message, index, "assistant");
		const existing = findBlock(state, id);
		if (existing) {
			existing.body = body;
			existing.summary = compactWhitespace(body).slice(0, 120);
			existing.status = status;
		} else {
			appendBlock(
				state,
				makeBlock(state, {
					id,
					kind: "assistant",
					summary: compactWhitespace(body).slice(0, 120),
					body,
					status,
				}),
			);
		}
	});
}

function mergeStreamingText(previous: string, next: string): string {
	if (!next) return previous;
	if (!previous) return next;
	if (next === previous || next.startsWith(previous)) return next;
	if (previous.startsWith(next)) return previous;
	return `${previous}\n${next}`;
}

function updateToolResult(state: GrokState, toolCallId: string, value: unknown, status: GrokBlockStatus, error = false): void {
	const block = findTool(state, toolCallId);
	if (!block) {
		appendBlock(
			state,
			makeBlock(state, {
				id: `tool-${toolCallId}`,
				kind: "tool",
				toolCallId,
				toolName: "tool",
				summary: `tool ${toolCallId}`,
				body: displayText(value),
				status,
				startedAt: now(),
				endedAt: status === "streaming" || status === "pending" ? undefined : now(),
			}),
		);
		return;
	}
	const text = displayText(value);
	const previousOutput = block.command && block.body === block.command ? "" : block.body;
	block.body = status === "streaming" ? mergeStreamingText(previousOutput, text) : text || previousOutput;
	block.status = status;
	if (error) block.errorMessage = text || "Tool execution failed";
	if (status !== "streaming" && status !== "pending") {
		block.endedAt = now();
		if (!block.manualExpansion) block.expanded = defaultExpanded("tool", status, state);
	}
}

export function hydrateGrokState(branch: readonly SessionEntryLike[]): GrokState {
	const state = createGrokState();
	for (const entry of branch) {
		if (entry.type !== "message" || !entry.message) continue;
		const message = entry.message;
		upsertMessageBlocks(state, message, statusForMessage(message));
		if (message.role === "toolResult") {
			const toolCallId = message.toolCallId;
			if (toolCallId) updateToolResult(state, toolCallId, message.content, message.isError ? "error" : "completed", Boolean(message.isError));
		}
	}
	return state;
}

export function applyGrokEvent(state: GrokState, event: GrokEventLike): void {
	state.lastEventAt = event.timestamp ?? now();
	if (event.turnIndex !== undefined) state.activeTurn = event.turnIndex;

	switch (event.type) {
		case "turn_start":
			state.activeTurn = event.turnIndex;
			return;
		case "message_start":
			if (event.message) upsertMessageBlocks(state, event.message, "streaming");
			return;
		case "message_update":
			if (event.message) upsertMessageBlocks(state, event.message, "streaming");
			return;
		case "message_end":
			if (event.message) upsertMessageBlocks(state, event.message, statusForMessage(event.message));
			return;
		case "tool_execution_start":
			if (event.toolCallId) {
				const toolName = event.toolName ?? "tool";
				const command = toolCommand(toolName, event.args);
				const existing = findTool(state, event.toolCallId);
				if (existing) {
					existing.status = "streaming";
					existing.startedAt = existing.startedAt ?? now();
					existing.toolName = toolName;
					existing.args = event.args;
					existing.command = command;
					existing.summary = `${toolName}: ${compactWhitespace(command).slice(0, 100)}`;
					if (!existing.body) existing.body = command;
				} else {
					appendBlock(
						state,
						makeBlock(state, {
							id: `tool-${event.toolCallId}`,
							kind: "tool",
							toolCallId: event.toolCallId,
							toolName,
							args: event.args,
							command,
							summary: `${toolName}: ${compactWhitespace(command).slice(0, 100)}`,
							body: command,
							status: "streaming",
							startedAt: now(),
						}),
					);
				}
			}
			return;
		case "tool_execution_update":
			if (event.toolCallId) updateToolResult(state, event.toolCallId, event.partialResult, "streaming");
			return;
		case "tool_execution_end":
			if (event.toolCallId) updateToolResult(state, event.toolCallId, event.result, event.isError ? "error" : "completed", Boolean(event.isError));
			return;
		case "agent_settled":
			for (const block of state.blocks) {
				if (block.status === "streaming" || block.status === "pending") {
					block.status = "incomplete";
					if (!block.manualExpansion && (block.kind === "thinking" || block.kind === "tool")) block.expanded = true;
				}
			}
			return;
		default:
			return;
	}
}

export function setBlockExpanded(state: GrokState, index: number, expanded: boolean): void {
	const block = state.blocks[index];
	if (!block || !block.selectable || !["thinking", "tool"].includes(block.kind)) return;
	block.expanded = expanded;
	block.manualExpansion = true;
}

export function toggleBlock(state: GrokState, index: number): void {
	const block = state.blocks[index];
	if (!block) return;
	if (block.kind === "thinking" || block.kind === "tool") setBlockExpanded(state, index, !block.expanded);
}

export function toggleAll(state: GrokState, kind: "thinking" | "tool"): void {
	const next = kind === "thinking" ? !state.thinkingGloballyExpanded : !state.toolsGloballyExpanded;
	if (kind === "thinking") state.thinkingGloballyExpanded = next;
	else state.toolsGloballyExpanded = next;
	for (const block of state.blocks) {
		if (block.kind === kind) {
			block.expanded = next;
			block.manualExpansion = false;
		}
	}
}

export function moveSelection(state: GrokState, direction: -1 | 1): void {
	if (state.blocks.length === 0) return;
	let next = state.selectedIndex;
	for (let i = 0; i < state.blocks.length; i++) {
		next = (next + direction + state.blocks.length) % state.blocks.length;
		if (state.blocks[next]?.selectable) {
			state.selectedIndex = next;
			return;
		}
	}
}

export function setSelectedIndex(state: GrokState, index: number): void {
	if (state.blocks.length === 0) {
		state.selectedIndex = 0;
		return;
	}
	state.selectedIndex = Math.max(0, Math.min(state.blocks.length - 1, index));
}

export function selectedBlock(state: GrokState): GrokBlock | undefined {
	return state.blocks[state.selectedIndex];
}

export function isGrokBlockKind(value: string): value is GrokBlockKind {
	return BLOCK_KINDS.includes(value as GrokBlockKind);
}
