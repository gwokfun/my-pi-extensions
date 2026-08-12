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
	assert.match(lines[2], /^  › - ◆ Bash pwd/);
	assert.ok(lines.includes("      bash body"));
	assert.ok(!lines.includes("      read body"));
});

test("aggregates reads as a file count with requested ranges and returned line counts", () => {
	const store = new ToolAggregationStore();
	store.beginTurn(0);
	const { group } = store.upsert("a", "read", { path: "afile", offset: 1, limit: 300 }, 1);
	store.upsert("b", "read", { path: "bfile", offset: 1, limit: 400 }, 2);
	store.settle("a", output(Array.from({ length: 77 }, (_, index) => `a${index}`).join("\n")), false, 3);
	store.settle("b", output(Array.from({ length: 177 }, (_, index) => `b${index}`).join("\n")), false, 4);
	assert.deepEqual(groupLines(group).map((line) => line.text), ["▶ read 2 files"]);
	store.toggleGroup();
	assert.deepEqual(groupLines(group).map((line) => line.text), [
		"▼ read 2 files",
		"  › - afile (1-300) (77 lines)",
		"    - bfile (1-400) (177 lines)",
	]);
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

test("repeated renders reuse settled calls without creating groups or invalidation loops", () => {
	const store = new ToolAggregationStore();
	let changes = 0;
	store.onChange(() => changes++);
	store.beginTurn(100);
	store.upsert("same", "read", { path: "a" }, 110);
	store.settle("same", output("body"), false, 120);
	store.endTurn(130);
	const settledChanges = changes;
	for (let index = 0; index < 50; index++) {
		store.upsert("same", "read", { path: "a" }, 1_000 + index);
		store.settle("same", output("body"), false, 1_000 + index);
	}
	assert.equal(store.groups.length, 1);
	assert.equal(store.groups[0].calls.length, 1);
	assert.equal(changes, settledChanges);
});
