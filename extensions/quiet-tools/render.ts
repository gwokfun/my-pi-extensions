import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatTool } from "./format.ts";

class CompactText implements Component {
	private readonly collapsed: string;
	private readonly expanded?: string;
	constructor(collapsed: string, expanded?: string) {
		this.collapsed = collapsed;
		this.expanded = expanded;
	}
	render(width: number): string[] {
		const first = truncateToWidth(this.collapsed.replace(/[\r\n]+/g, " "), Math.max(1, width), "…");
		if (!this.expanded) return [first];
		return [first, ...this.expanded.split(/\r?\n/).map((line) => truncateToWidth(line, Math.max(1, width), "…"))];
	}
	invalidate(): void {}
}

class Empty implements Component {
	render(): string[] { return []; }
	invalidate(): void {}
}

export function renderCollapsedCall(name: string, args: unknown, theme: any, context: { isPartial?: boolean } = {}): Component {
	// Once a call settles, renderResult owns the row. This avoids the two-line
	// pending/completed cards produced by the default Pi shell.
	if (context.isPartial === false) return new Empty();
	const view = formatTool(name, args, undefined, { isPartial: true });
	return new CompactText(theme.fg("dim", view.line));
}

export function renderCollapsedResult(name: string, args: unknown, result: unknown, options: { expanded: boolean; isPartial: boolean; isError: boolean }, theme: any): Component {
	const view = formatTool(name, args, result, options);
	if (options.isPartial) return new Empty();
	const line = view.success ? theme.fg("muted", view.line) : theme.fg("error", view.line);
	return new CompactText(line, options.expanded || !view.success ? view.expanded : undefined);
}
