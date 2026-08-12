import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderCollapsedCall, renderCollapsedResult } from "./render.ts";

const theme = { fg: (_color: string, text: string) => text };

test("narrow collapsed results remain one truncated line", () => {
	const component = renderCollapsedResult("unknown", { huge: "x".repeat(80) }, { content: [{ type: "text", text: "y".repeat(80) }] }, { expanded: false, isPartial: false, isError: false }, theme);
	const lines = component.render(18);
	assert.equal(lines.length, 1);
	assert.ok(visibleWidth(lines[0]) <= 18);
});

test("error output expands by default", () => {
	const component = renderCollapsedResult("unknown", {}, { content: [{ type: "text", text: "bad details" }] }, { expanded: false, isPartial: false, isError: true }, theme);
	assert.ok(component.render(80).length > 1);
});

test("settled calls and partial results render no duplicate row", () => {
	assert.deepEqual(renderCollapsedCall("bash", { command: "true" }, theme, { isPartial: false }).render(80), []);
	assert.deepEqual(renderCollapsedResult("bash", { command: "true" }, {}, { expanded: false, isPartial: true, isError: false }, theme).render(80), []);
});
