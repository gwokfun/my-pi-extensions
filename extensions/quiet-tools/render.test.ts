import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { aggregationStore } from "./aggregate.ts";
import { renderCollapsedCall, renderCollapsedResult } from "./render.ts";

const theme = { fg: (_color: string, text: string) => text };

test("only the first tool row anchors an aggregate and remains width-safe", () => {
	aggregationStore.reset();
	aggregationStore.beginTurn(0);
	const first = renderCollapsedCall("read", { path: "x".repeat(100) }, theme, { toolCallId: "a", isPartial: true });
	const second = renderCollapsedCall("bash", { command: "pwd" }, theme, { toolCallId: "b", isPartial: true });
	assert.equal(first.render(18).length, 1);
	assert.ok(visibleWidth(first.render(18)[0]) <= 18);
	assert.deepEqual(second.render(80), []);
});

test("result slots stay empty while updating the aggregate", () => {
	const result = renderCollapsedResult("read", { path: "a" }, { content: [{ type: "text", text: "body" }] }, { isPartial: false, isError: false }, theme, { toolCallId: "a" });
	assert.deepEqual(result.render(80), []);
	assert.equal(aggregationStore.current()?.calls[0].endedAt !== undefined, true);
});

test("reuses the aggregate component supplied by Pi on rerender", () => {
	aggregationStore.reset();
	aggregationStore.beginTurn(0);
	const first = renderCollapsedCall("read", { path: "a" }, theme, { toolCallId: "stable" });
	const second = renderCollapsedCall("read", { path: "a" }, theme, { toolCallId: "stable", lastComponent: first });
	assert.equal(second, first);
	assert.equal(aggregationStore.groups.length, 1);
});
