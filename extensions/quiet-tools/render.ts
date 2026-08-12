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

export function renderCollapsedCall(name: string, args: unknown, theme: any): Component {
	const view = formatTool(name, args, undefined, { isPartial: true });
	return new CompactText(theme.fg("toolTitle", view.line));
}

export function renderCollapsedResult(name: string, args: unknown, result: unknown, options: { expanded: boolean; isPartial: boolean; isError: boolean }, theme: any): Component {
	const view = formatTool(name, args, result, options);
	const color = options.isPartial ? "warning" : view.success ? "success" : "error";
	return new CompactText(theme.fg(color, view.line), options.expanded || !view.success ? view.expanded : undefined);
}
