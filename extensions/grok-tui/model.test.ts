import assert from "node:assert/strict";
import test from "node:test";
import {
	applyGrokEvent,
	hydrateGrokState,
	moveSelection,
	setBlockExpanded,
	toggleAll,
	toggleBlock,
	type GrokState,
} from "./model.ts";

function assistant(timestamp: number, content: unknown[]): { type: "message"; message: Record<string, unknown> } {
	return { type: "message", message: { role: "assistant", timestamp, content } };
}

function blockOf(state: GrokState, kind: string, id?: string) {
	return state.blocks.find((block) => block.kind === kind && (id === undefined || block.toolCallId === id));
}

test("hydrates user, thinking, assistant, and tool blocks from a branch", () => {
	const state = hydrateGrokState([
		{ type: "message", message: { role: "user", timestamp: 1, content: "inspect the repo" } },
		assistant(2, [
			{ type: "thinking", thinking: "check the current state" },
			{ type: "text", text: "I will inspect it." },
			{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "git status --short" } },
		]),
		{
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: "tool-1",
				content: [{ type: "text", text: "clean" }],
				isError: false,
			},
		},
	]);

	assert.deepEqual(
		state.blocks.map((block) => block.kind),
		["user", "thinking", "assistant", "tool"],
	);
	assert.equal(blockOf(state, "thinking")?.expanded, false);
	assert.equal(blockOf(state, "tool", "tool-1")?.expanded, false);
	assert.equal(blockOf(state, "tool", "tool-1")?.command, "git status --short");
	assert.equal(blockOf(state, "tool", "tool-1")?.body, "clean");
});

test("keeps thinking expanded while streaming and folds it after completion", () => {
	const state = hydrateGrokState([]);
	applyGrokEvent(state, {
		type: "message_update",
		message: { role: "assistant", timestamp: 10, content: [{ type: "thinking", thinking: "partial" }] },
	});
	const thinking = blockOf(state, "thinking")!;
	assert.equal(thinking.status, "streaming");
	assert.equal(thinking.expanded, true);

	applyGrokEvent(state, {
		type: "message_end",
		message: { role: "assistant", timestamp: 10, content: [{ type: "thinking", thinking: "complete" }] },
	});
	assert.equal(thinking.status, "completed");
	assert.equal(thinking.body, "complete");
	assert.equal(thinking.expanded, false);
});

test("pairs interleaved tool events by tool call id and preserves error output", () => {
	const state = hydrateGrokState([]);
	applyGrokEvent(state, { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: { command: "echo a" } });
	applyGrokEvent(state, { type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: { command: "echo b" } });
	applyGrokEvent(state, { type: "tool_execution_update", toolCallId: "b", partialResult: { content: [{ type: "text", text: "b output" }] } });
	applyGrokEvent(state, { type: "tool_execution_update", toolCallId: "a", partialResult: { content: [{ type: "text", text: "a output" }] } });
	applyGrokEvent(state, { type: "tool_execution_end", toolCallId: "b", result: { content: [{ type: "text", text: "failed" }] }, isError: true });
	applyGrokEvent(state, { type: "tool_execution_end", toolCallId: "a", result: { content: [{ type: "text", text: "done" }] }, isError: false });

	assert.equal(blockOf(state, "tool", "a")?.body, "done");
	assert.equal(blockOf(state, "tool", "a")?.status, "completed");
	assert.equal(blockOf(state, "tool", "b")?.body, "failed");
	assert.equal(blockOf(state, "tool", "b")?.status, "error");
	assert.equal(blockOf(state, "tool", "b")?.expanded, true);
});

test("manual folding survives streaming updates and global toggles apply to future blocks", () => {
	const state = hydrateGrokState([]);
	applyGrokEvent(state, {
		type: "message_update",
		message: { role: "assistant", timestamp: 20, content: [{ type: "thinking", thinking: "first" }] },
	});
	setBlockExpanded(state, 0, false);
	applyGrokEvent(state, {
		type: "message_update",
		message: { role: "assistant", timestamp: 20, content: [{ type: "thinking", thinking: "second" }] },
	});
	assert.equal(state.blocks[0]?.expanded, false);

	toggleAll(state, "thinking");
	assert.equal(state.blocks[0]?.expanded, true);
	applyGrokEvent(state, {
		type: "message_end",
		message: { role: "assistant", timestamp: 21, content: [{ type: "thinking", thinking: "future" }] },
	});
	assert.equal(state.blocks[1]?.expanded, true);

	toggleBlock(state, 1);
	assert.equal(state.blocks[1]?.expanded, false);
});

test("selection wraps across blocks and unsettled streaming blocks become incomplete", () => {
	const state = hydrateGrokState([
		{ type: "message", message: { role: "user", timestamp: 1, content: "one" } },
		assistant(2, [{ type: "text", text: "two" }]),
	]);
	state.selectedIndex = 0;
	moveSelection(state, -1);
	assert.equal(state.selectedIndex, 1);
	applyGrokEvent(state, { type: "tool_execution_start", toolCallId: "pending", toolName: "bash", args: { command: "sleep 1" } });
	applyGrokEvent(state, { type: "agent_settled" });
	assert.equal(blockOf(state, "tool", "pending")?.status, "incomplete");
});

