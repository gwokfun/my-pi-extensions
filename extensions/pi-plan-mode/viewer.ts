import type { ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

export type PlanViewerAction = "approve" | "revise" | "abandon" | "dismiss";

export interface PlanViewerOptions {
	content: string;
	planPath: string;
	revision: number;
	interactive: boolean;
}

export class PlanViewerComponent {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly options: PlanViewerOptions;
	private readonly done: (action: PlanViewerAction) => void;
	private readonly markdown: Markdown;
	private scrollOffset = 0;
	private pageSize = 1;
	private maxScroll = 0;
	private completed = false;

	constructor(tui: TUI, theme: Theme, options: PlanViewerOptions, done: (action: PlanViewerAction) => void) {
		this.tui = tui;
		this.theme = theme;
		this.options = options;
		this.done = done;
		this.markdown = new Markdown(options.content, 0, 0, getMarkdownTheme());
	}

	dispose(): void {
		this.completed = true;
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	private finish(action: PlanViewerAction): void {
		if (this.completed) return;
		this.completed = true;
		this.done(action);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.finish("dismiss");
			return;
		}
		if (this.options.interactive && matchesKey(data, "a")) {
			this.finish("approve");
			return;
		}
		if (this.options.interactive && matchesKey(data, "r")) {
			this.finish("revise");
			return;
		}
		if (this.options.interactive && matchesKey(data, "q")) {
			this.finish("abandon");
			return;
		}
		if (!this.options.interactive && matchesKey(data, "q")) {
			this.finish("dismiss");
			return;
		}

		const previous = this.scrollOffset;
		if (matchesKey(data, "up") || matchesKey(data, "k")) this.scrollOffset--;
		else if (matchesKey(data, "down") || matchesKey(data, "j")) this.scrollOffset++;
		else if (matchesKey(data, "pageUp")) this.scrollOffset -= this.pageSize;
		else if (matchesKey(data, "pageDown")) this.scrollOffset += this.pageSize;
		else if (matchesKey(data, "home")) this.scrollOffset = 0;
		else if (matchesKey(data, "end")) this.scrollOffset = this.maxScroll;
		else return;

		this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset));
		if (this.scrollOffset !== previous) this.tui.requestRender();
	}

	private fit(text: string, width: number): string {
		const clipped = truncateToWidth(text, Math.max(1, width), "...", true);
		return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		const markdownWidth = Math.max(16, innerWidth - 2);
		const rendered = this.markdown.render(markdownWidth);
		const terminalRows = Math.max(12, this.tui.terminal.rows || 24);
		this.pageSize = Math.max(4, Math.floor(terminalRows * 0.78) - 7);
		this.maxScroll = Math.max(0, rendered.length - this.pageSize);
		this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset));

		const visible = rendered.slice(this.scrollOffset, this.scrollOffset + this.pageSize);
		while (visible.length < this.pageSize) visible.push("");

		const title = this.options.interactive ? "Plan Review" : "Plan Preview";
		const titleText = ` ${title} · revision ${this.options.revision} `;
		const clippedTitle = truncateToWidth(titleText, innerWidth, "...", true);
		const titleWidth = visibleWidth(clippedTitle);
		const left = Math.max(0, Math.floor((innerWidth - titleWidth) / 2));
		const right = Math.max(0, innerWidth - titleWidth - left);
		const border = (text: string) => this.theme.fg("border", text);
		const body = (text: string) => border("│") + this.fit(text, innerWidth) + border("│");

		const total = Math.max(1, rendered.length);
		const first = rendered.length === 0 ? 0 : this.scrollOffset + 1;
		const last = Math.min(rendered.length, this.scrollOffset + this.pageSize);
		const scroll = `${first}-${last}/${total}`;
		const actions = this.options.interactive
			? "a approve · r revise · q abandon · Esc close"
			: "q/Esc close";

		return [
			border(`╭${"─".repeat(left)}`) + this.theme.fg("accent", clippedTitle) + border(`${"─".repeat(right)}╮`),
			body(` ${this.theme.fg("muted", truncateToWidth(this.options.planPath, Math.max(1, innerWidth - 2), "...", true))}`),
			body(border("─".repeat(innerWidth))),
			...visible.map((line) => body(` ${line}`)),
			body(border("─".repeat(innerWidth))),
			body(` ${this.theme.fg("dim", `${scroll} · ↑↓/j/k · PgUp/PgDn · Home/End`)} `),
			body(` ${this.theme.fg("accent", actions)} `),
			border(`╰${"─".repeat(innerWidth)}╯`),
		];
	}
}

export async function openPlanViewer(
	ctx: ExtensionContext | ExtensionCommandContext,
	options: PlanViewerOptions,
): Promise<PlanViewerAction> {
	if (ctx.mode !== "tui") throw new Error("Plan preview requires interactive TUI mode.");
	return ctx.ui.custom<PlanViewerAction>(
		(tui, theme, _keybindings, done) => new PlanViewerComponent(tui, theme, options, done),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "96%",
				maxHeight: "92%",
				margin: { top: 1, bottom: 1 },
			},
		},
	);
}
