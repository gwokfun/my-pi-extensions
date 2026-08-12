import assert from "node:assert/strict";
import test from "node:test";
import { formatTool, registerToolAdapter, safeStringify } from "./format.ts";

const result = (text: string, details?: unknown) => ({ content: [{ type: "text", text }], details });

test("bash reports success, failure, streaming, and truncation", () => {
	assert.match(formatTool("bash", { command: "true" }, result("ok", { exitCode: 0 })).line, /^◆ Bash true · done/);
	const failed = formatTool("bash", { command: "false" }, result("exit code: 7", { exitCode: 7 }));
	assert.equal(failed.success, false);
	assert.match(failed.line, /exit 7/);
	assert.match(formatTool("bash", { command: "sleep 1" }, result(""), { isPartial: true }).line, /^◇ .*running/);
	assert.match(formatTool("bash", { command: "seq 99" }, result("...", { exitCode: 0, truncation: { truncated: true } })).line, /truncated/);
});

test("built-in file and search adapters produce concise summaries", () => {
	assert.match(formatTool("read", { path: "README.md", offset: 2 }, result("a\nb", { lineCount: 2, totalLines: 170 })).line, /Read README\.md · 2–3 of 170/);
	assert.match(formatTool("edit", { path: "a.ts" }, result("ok")).line, /Edit a\.ts · updated/);
	assert.match(formatTool("write", { path: "b.ts" }, result("ok")).line, /Write b\.ts · written/);
	assert.match(formatTool("find", { path: ".", pattern: "*.ts" }, result("a.ts\nb.ts")).line, /2 matches/);
	assert.match(formatTool("grep", { path: "src", pattern: "todo" }, result("a:1\nb:2")).line, /Grep todo src · 2 matches/);
	assert.match(formatTool("ls", { path: "src" }, result("a\nb")).line, /List src · 2 entries/);
});

test("errors are unsuccessful and retain expandable content", () => {
	const view = formatTool("unknown", { x: 1 }, result("permission denied"), { isError: true });
	assert.equal(view.success, false);
	assert.match(view.expanded, /permission denied/);
});

test("web_search and fd can add adapters without changing the renderer", () => {
	for (const name of ["web_search", "fd"]) {
		const unregister = registerToolAdapter({
			match: name,
			summarizeCall: (args) => `${name}: ${String((args as { query?: string }).query ?? "")}`,
			summarizeResult: () => "custom result",
			expandedContent: (_args, output) => JSON.stringify(output),
		});
		assert.match(formatTool(name, { query: "pi" }, result("hit")).line, /custom result/);
		unregister();
	}
});

test("unknown and circular or unserializable values never throw", () => {
	const circular: Record<string, unknown> = { bigint: 1n };
	circular.self = circular;
	assert.doesNotThrow(() => formatTool("future_tool", circular, circular));
	assert.match(safeStringify(circular), /Circular/);
});
