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
		this.active = { id: this.groups.length + 1, calls: [], startedAt: at, expanded: false, selected: 0 };
		this.groups.push(this.active);
		this.selectedGroup = this.groups.length - 1;
		this.emit();
	}
	endTurn(at = Date.now()): void { if (this.active) this.active.endedAt = at; this.active = undefined; this.emit(); }
	upsert(id: string, name: string, args: unknown, at = Date.now()): { group: ToolGroup; call: AggregatedCall; anchor: boolean } {
		if (!this.active) this.beginTurn(at);
		const group = this.active!;
		let call = group.calls.find((item) => item.id === id);
		if (!call) {
			call = { id, name, args, isError: false, startedAt: at, expanded: false };
			group.calls.push(call);
		}
		call.args = args;
		this.emit();
		return { group, call, anchor: group.calls[0] === call };
	}
	settle(id: string, result: unknown, isError: boolean, at = Date.now()): void {
		const call = this.groups.flatMap((group) => group.calls).find((item) => item.id === id);
		if (!call) return;
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
	const header = `${group.expanded ? "▼" : "▶"} ${complete}/${group.calls.length} tools · ${duration.toFixed(1)}s`;
	if (!group.expanded) return [{ text: header }];
	const lines: Array<{ text: string; error?: boolean }> = [{ text: header }];
	group.calls.forEach((call, index) => {
		const view = formatTool(call.name, call.args, call.result, { isPartial: !call.endedAt, isError: call.isError });
		lines.push({ text: `  ${index === group.selected ? "›" : " "} ${view.line}`, error: !view.success });
		if (call.expanded && view.expanded) for (const line of view.expanded.split(/\r?\n/)) lines.push({ text: `      ${line}`, error: !view.success });
	});
	return lines;
}

export const aggregationStore = new ToolAggregationStore();
