import assert from "node:assert/strict";
import test from "node:test";
import { groupLines, ToolAggregationStore } from "./aggregate.ts";

const output = (text: string) => ({ content: [{ type: "text", text }] });

test("aggregates all tools in a turn into a collapsed time-range row", () => {
	const store = new ToolAggregationStore();
	store.beginTurn(1_000);
	const first = store.upsert("a", "read", { path: "a.ts" }, 1_100);
	const second = store.upsert("b", "grep", { pattern: "TODO", path: "src" }, 1_200);
	store.settle("a", output("one"), false, 1_500);
	store.settle("b", output("two"), false, 2_000);
	store.endTurn(2_000);
	assert.equal(first.anchor, true);
	assert.equal(second.anchor, false);
	assert.deepEqual(groupLines(first.group).map((line) => line.text), ["▶ 2/2 tools · 1.0s"]);
});

test("supports independent group and selected-tool detail folding", () => {
	const store = new ToolAggregationStore();
	store.beginTurn(0);
	const { group } = store.upsert("a", "read", { path: "a.ts" }, 1);
	store.upsert("b", "bash", { command: "pwd" }, 2);
	store.settle("a", output("read body"), false, 3);
	store.settle("b", output("bash body"), false, 4);
	store.toggleGroup();
	assert.equal(groupLines(group).length, 3);
	store.move(1);
	store.toggleCall();
	const lines = groupLines(group).map((line) => line.text);
	assert.match(lines[2], /^  › ◆ Bash pwd/);
	assert.ok(lines.includes("      bash body"));
	assert.ok(!lines.includes("      read body"));
});

test("selects and opens one aggregate group without changing its siblings", () => {
	const store = new ToolAggregationStore();
	store.beginTurn(0); store.upsert("a", "read", { path: "a" }, 1); store.endTurn(2);
	store.beginTurn(3); store.upsert("b", "read", { path: "b" }, 4); store.endTurn(5);
	store.moveGroup(-1);
	store.toggleGroup();
	assert.equal(store.groups[0].expanded, true);
	assert.equal(store.groups[1].expanded, false);
});
