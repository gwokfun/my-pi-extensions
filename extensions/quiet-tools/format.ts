export interface ToolCollapseAdapter {
	match: string | ((toolName: string) => boolean);
	summarizeCall(args: unknown): string;
	summarizeResult(result: unknown, isPartial: boolean, args?: unknown): string;
	expandedContent(args: unknown, result: unknown): string;
	isSuccess?(result: unknown): boolean;
}

const adapters: ToolCollapseAdapter[] = [];

export function registerToolAdapter(adapter: ToolCollapseAdapter): () => void {
	adapters.unshift(adapter);
	return () => {
		const index = adapters.indexOf(adapter);
		if (index >= 0) adapters.splice(index, 1);
	};
}

export function findToolAdapter(name: string): ToolCollapseAdapter {
	return adapters.find((adapter) =>
		typeof adapter.match === "string" ? adapter.match === name : adapter.match(name),
	) ?? fallbackAdapter(name);
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	try {
		return JSON.stringify(value, (_key, item) => {
			if (typeof item === "bigint") return `${item}n`;
			if (typeof item === "object" && item !== null) {
				if (seen.has(item)) return "[Circular]";
				seen.add(item);
			}
			return item;
		}) ?? String(value);
	} catch {
		return String(value);
	}
}

export function resultText(result: unknown): string {
	const value = record(result);
	const content = value.content;
	if (Array.isArray(content)) return content.map((item) => {
		const entry = record(item);
		return typeof entry.text === "string" ? entry.text : safeStringify(item);
	}).join("\n");
	if (typeof content === "string") return content;
	return safeStringify(result);
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function pathSummary(verb: string, args: unknown, extra = ""): string {
	const input = record(args);
	return `${verb} ${String(input.path ?? input.pattern ?? "")}${extra}`.trim();
}

function requestedRange(args: unknown, result: unknown): string {
	const input = record(args);
	const details = record(record(result).details);
	const start = Number(input.offset ?? 1);
	const returned = Number(details.lineCount ?? resultText(result).split("\n").filter(Boolean).length);
	const total = Number(details.totalLines ?? details.lineCount ?? returned);
	return returned > 0 ? `${start}–${Math.min(total, start + returned - 1)} of ${total}` : "empty";
}

function fallbackAdapter(name: string): ToolCollapseAdapter {
	return {
		match: name,
		summarizeCall: (args) => `${name} ${oneLine(safeStringify(args))}`.trim(),
		summarizeResult: (result, partial) => partial ? "running" : oneLine(resultText(result)) || "done",
		expandedContent: (args, result) => `${safeStringify(args)}\n${resultText(result)}`.trim(),
	};
}

export const builtInAdapters: ToolCollapseAdapter[] = [
	{
		match: "read",
		summarizeCall: (a) => `Read ${String(record(a).path ?? "")}`,
		summarizeResult: (r, p, a) => p ? "reading" : requestedRange(a, r),
		expandedContent: (_a, r) => resultText(r),
	},
	{
		match: "bash",
		summarizeCall: (args) => `Bash ${String(record(args).command ?? "")}`,
		summarizeResult: (result, partial) => partial ? "running" : (() => {
			const details = record(record(result).details);
			const code = details.exitCode ?? resultText(result).match(/exit code:?\s*(-?\d+)/i)?.[1];
			const truncated = record(details.truncation).truncated ? " · truncated" : "";
			return code !== undefined && Number(code) !== 0 ? `exit ${code}${truncated}` : `done${truncated}`;
		})(),
		expandedContent: (_args, result) => resultText(result),
		isSuccess: (result) => {
			const details = record(record(result).details);
			const code = details.exitCode ?? resultText(result).match(/exit code:?\s*(-?\d+)/i)?.[1];
			return code === undefined || Number(code) === 0;
		},
	},
	{ match: "edit", summarizeCall: (a) => pathSummary("Edit", a), summarizeResult: (_r, p) => p ? "editing" : "updated", expandedContent: (_a, r) => resultText(r) },
	{ match: "write", summarizeCall: (a) => pathSummary("Write", a), summarizeResult: (_r, p) => p ? "writing" : "written", expandedContent: (_a, r) => resultText(r) },
	{ match: "find", summarizeCall: (a) => pathSummary("Find", a, ` · ${String(record(a).pattern ?? "*")}`), summarizeResult: (r, p) => p ? "searching" : `${resultText(r).split("\n").filter(Boolean).length} matches`, expandedContent: (_a, r) => resultText(r) },
	{ match: "grep", summarizeCall: (a) => `Grep ${String(record(a).pattern ?? "")} ${String(record(a).path ?? ".")}`, summarizeResult: (r, p) => p ? "searching" : `${resultText(r).split("\n").filter(Boolean).length} matches`, expandedContent: (_a, r) => resultText(r) },
	{ match: "ls", summarizeCall: (a) => pathSummary("List", a), summarizeResult: (r, p) => p ? "listing" : `${resultText(r).split("\n").filter(Boolean).length} entries`, expandedContent: (_a, r) => resultText(r) },
];

for (const adapter of builtInAdapters) registerToolAdapter(adapter);

export interface RenderedTool {
	line: string;
	expanded: string;
	success: boolean;
}

export function formatTool(name: string, args: unknown, result: unknown, options: { isPartial?: boolean; isError?: boolean } = {}): RenderedTool {
	const adapter = findToolAdapter(name);
	const success = !options.isError && (adapter.isSuccess?.(result) ?? true);
	const icon = options.isPartial ? "◇" : success ? "◆" : "✗";
	const call = oneLine(adapter.summarizeCall(args));
	const summary = oneLine(adapter.summarizeResult(result, options.isPartial ?? false, args));
	return { line: `${icon} ${call}${summary ? ` · ${summary}` : ""}`, expanded: adapter.expandedContent(args, result), success };
}
