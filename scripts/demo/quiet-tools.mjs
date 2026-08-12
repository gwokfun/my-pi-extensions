#!/usr/bin/env node

import { ToolAggregationStore, groupLines } from "../../extensions/quiet-tools/aggregate.ts";

const result = (prefix, lines) => ({
	content: [{ type: "text", text: Array.from({ length: lines }, (_, index) => `${prefix} line ${index + 1}`).join("\n") }],
});

const reads = [
	["afile", 300, 77],
	["bfile", 400, 177],
	["cfile", 200, 17],
	["dfile", 500, 337],
];

const store = new ToolAggregationStore();
store.beginTurn(1_000);
for (const [path, limit] of reads) store.upsert(path, "read", { path, offset: 1, limit }, 1_100);
for (const [path, _limit, lines] of reads) store.settle(path, result(path, lines), false, 2_000);
store.endTurn(2_000);

const group = store.groups[0];
process.stdout.write("Collapsed:\n");
process.stdout.write(`${groupLines(group).map(({ text }) => text).join("\n")}\n\n`);
store.toggleGroup();
process.stdout.write("Expanded:\n");
process.stdout.write(`${groupLines(group).map(({ text }) => text).join("\n")}\n`);
