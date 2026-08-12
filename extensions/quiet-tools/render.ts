import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { aggregationStore, groupLines, type ToolGroup } from "./aggregate.ts";

class Empty implements Component { render(): string[] { return []; } invalidate(): void {} }

class AggregateView implements Component {
	private requestRender?: () => void;
	private unsubscribe?: () => void;
	private group: ToolGroup;
	private theme: any;
	constructor(group: ToolGroup, theme: any) { this.group = group; this.theme = theme; }
	update(group: ToolGroup, theme: any, requestRender?: () => void): void {
		this.group = group;
		this.theme = theme;
		this.requestRender = requestRender;
	}
	render(width: number): string[] {
		if (!this.unsubscribe && this.requestRender) this.unsubscribe = aggregationStore.onChange(this.requestRender);
		return groupLines(this.group).map(({ text, error }, index) => {
			const selected = index === 0 && aggregationStore.current() === this.group;
			const display = index === 0 ? `${selected ? "›" : " "} ${text}` : text;
			return truncateToWidth(this.theme.fg(error ? "error" : selected ? "accent" : index === 0 ? "dim" : "muted", display), Math.max(1, width), "…");
		});
	}
	invalidate(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }
}

interface RenderContext { toolCallId?: string; isPartial?: boolean; invalidate?: () => void; lastComponent?: unknown }

export function renderCollapsedCall(name: string, args: unknown, theme: any, context: RenderContext = {}): Component {
	const id = context.toolCallId ?? `${name}-${Date.now()}`;
	const { group, anchor } = aggregationStore.upsert(id, name, args);
	if (!anchor) return new Empty();
	const component = context.lastComponent instanceof AggregateView ? context.lastComponent : new AggregateView(group, theme);
	component.update(group, theme, () => context.invalidate?.());
	return component;
}

export function renderCollapsedResult(name: string, args: unknown, result: unknown, options: { isPartial: boolean; isError: boolean }, _theme: any, context: RenderContext = {}): Component {
	const id = context.toolCallId;
	if (id) {
		aggregationStore.upsert(id, name, args);
		if (!options.isPartial) aggregationStore.settle(id, result, options.isError);
	}
	return new Empty();
}
