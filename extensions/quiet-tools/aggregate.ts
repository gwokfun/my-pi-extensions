import { formatTool } from "./format.ts";

export interface AggregatedCall {
	id: string;
	name: string;
	args: unknown;
	result?: unknown;
	isError: boolean;
	startedAt: number;
	endedAt?: number;
	expanded: boolean;
}

export interface ToolGroup {
	id: number;
	calls: AggregatedCall[];
	startedAt: number;
	endedAt?: number;
	expanded: boolean;
	selected: number;
}

export class ToolAggregationStore {
	groups: ToolGroup[] = [];
	selectedGroup = 0;
	private active?: ToolGroup;
	private listeners = new Set<() => void>();

	reset(): void { this.groups = []; this.selectedGroup = 0; this.active = undefined; this.emit(); }
	beginTurn(at = Date.now()): void {
		if (this.active) return;
		this.active = { id: this.groups.length + 1, calls: [], startedAt: at, expanded: false, selected: 0 };
		this.groups.push(this.active);
		this.selectedGroup = this.groups.length - 1;
		this.emit();
	}
	endTurn(at = Date.now()): void { if (this.active) this.active.endedAt = at; this.active = undefined; this.emit(); }
	upsert(id: string, name: string, args: unknown, at = Date.now()): { group: ToolGroup; call: AggregatedCall; anchor: boolean } {
		// Pi may call renderCall again long after a row has settled. Always reuse
		// the call by id before considering the active turn, otherwise every
		// rerender creates another one-call group.
		for (const group of this.groups) {
			const existing = group.calls.find((item) => item.id === id);
			if (existing) {
				existing.name = name;
				existing.args = args;
				return { group, call: existing, anchor: group.calls[0] === existing };
			}
		}
		if (!this.active) this.beginTurn(at);
		const group = this.active!;
		const call = { id, name, args, isError: false, startedAt: at, expanded: false };
		group.calls.push(call);
		this.emit();
		return { group, call, anchor: group.calls[0] === call };
	}
	settle(id: string, result: unknown, isError: boolean, at = Date.now()): void {
		const call = this.groups.flatMap((group) => group.calls).find((item) => item.id === id);
		if (!call) return;
		if (call.endedAt !== undefined) return;
		call.result = result; call.isError = isError; call.endedAt = at; this.emit();
	}
	current(): ToolGroup | undefined { return this.groups[this.selectedGroup]; }
	moveGroup(delta: number): void {
		if (!this.groups.length) return;
		this.selectedGroup = (this.selectedGroup + delta + this.groups.length) % this.groups.length;
		this.emit();
	}
	toggleGroup(): void { const group = this.current(); if (group) { group.expanded = !group.expanded; this.emit(); } }
	move(delta: number): void { const group = this.current(); if (group?.calls.length) { group.selected = (group.selected + delta + group.calls.length) % group.calls.length; this.emit(); } }
	toggleCall(): void { const group = this.current(); const call = group?.calls[group.selected]; if (call) { group!.expanded = true; call.expanded = !call.expanded; this.emit(); } }
	onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private emit(): void { for (const listener of this.listeners) listener(); }
}

export function groupLines(group: ToolGroup): Array<{ text: string; error?: boolean }> {
	const end = group.endedAt ?? Math.max(Date.now(), ...group.calls.map((call) => call.endedAt ?? call.startedAt));
	const duration = Math.max(0, end - group.startedAt) / 1000;
	const complete = group.calls.filter((call) => call.endedAt).length;
	const allReads = group.calls.length > 0 && group.calls.every((call) => call.name === "read");
	const header = allReads
		? `${group.expanded ? "▼" : "▶"} read ${group.calls.length} ${group.calls.length === 1 ? "file" : "files"}`
		: `${group.expanded ? "▼" : "▶"} ${complete}/${group.calls.length} tools · ${duration.toFixed(1)}s`;
	if (!group.expanded) return [{ text: header }];
	const lines: Array<{ text: string; error?: boolean }> = [{ text: header }];
	group.calls.forEach((call, index) => {
		const view = formatTool(call.name, call.args, call.result, { isPartial: !call.endedAt, isError: call.isError });
		const summary = call.name === "read" ? readAggregateLine(call) : view.line;
		lines.push({ text: `  ${index === group.selected ? "›" : " "} - ${summary}`, error: !view.success });
		if (call.expanded && view.expanded) for (const line of view.expanded.split(/\r?\n/)) lines.push({ text: `      ${line}`, error: !view.success });
	});
	return lines;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readAggregateLine(call: AggregatedCall): string {
	const args = asRecord(call.args);
	const path = String(args.path ?? "<unknown>");
	const offset = Math.max(1, Number(args.offset ?? 1) || 1);
	const text = asRecord(call.result).content;
	const body = Array.isArray(text)
		? text.map((part) => asRecord(part).text).filter((part): part is string => typeof part === "string").join("\n")
		: "";
	const lineCount = body ? body.split(/\r?\n/).filter((line, index, rows) => index < rows.length - 1 || line.length > 0).length : 0;
	const limit = Number(args.limit);
	const requested = Number.isFinite(limit) && limit > 0 ? limit : lineCount;
	const end = offset + Math.max(0, requested - 1);
	return `${path} (${offset}-${end}) (${lineCount} ${lineCount === 1 ? "line" : "lines"})`;
}

export const aggregationStore = new ToolAggregationStore();
