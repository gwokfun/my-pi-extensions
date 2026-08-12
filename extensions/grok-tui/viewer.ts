import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import {
	applyGrokEvent,
	createGrokState,
	hydrateGrokState,
	moveSelection,
	setBlockExpanded,
	toggleAll,
	toggleBlock,
	type GrokEventLike,
	type GrokState,
	type SessionEntryLike,
} from "./model.ts";

export interface GrokTranscriptStore {
	readonly state: GrokState;
	loadBranch(branch: readonly SessionEntryLike[]): void;
	apply(event: GrokEventLike): void;
	subscribe(listener: () => void): () => void;
}

export function createGrokTranscriptStore(): GrokTranscriptStore {
	let state = createGrokState();
	const listeners = new Set<() => void>();
	const notify = () => listeners.forEach((listener) => listener());
	return {
		get state() {
			return state;
		},
		loadBranch(branch) {
			state = hydrateGrokState(branch);
			notify();
		},
		apply(event) {
			applyGrokEvent(state, event);
			notify();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function statusIcon(status: GrokState["blocks"][number]["status"]): string {
	switch (status) {
		case "streaming":
			return "◆";
		case "pending":
			return "◇";
		case "completed":
			return "◆";
		case "error":
			return "✗";
		case "cancelled":
			return "!";
		default:
			return "◇";
	}
}

function kindLabel(kind: GrokState["blocks"][number]["kind"]): string {
	switch (kind) {
		case "user":
			return "You";
		case "assistant":
			return "Assistant";
		case "thinking":
			return "Thought";
		case "tool":
			return "Run";
	}
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function wrapLines(value: string, width: number): string[] {
	const max = Math.max(8, width);
	const lines: string[] = [];
	for (const line of value.split("\n")) {
		if (line.length === 0) {
			lines.push("");
			continue;
		}
		let rest = line;
		while (rest.length > max) {
			let cut = rest.lastIndexOf(" ", max);
			if (cut < Math.floor(max * 0.55)) cut = max;
			lines.push(rest.slice(0, cut));
			rest = rest.slice(cut).replace(/^\s+/, "");
		}
		lines.push(rest);
	}
	return lines;
}

function formatDuration(startedAt?: number, endedAt?: number): string {
	if (!startedAt) return "";
	const ms = Math.max(0, (endedAt ?? Date.now()) - startedAt);
	return `${(ms / 1000).toFixed(1)}s`;
}

function fit(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(1, width), "...", true);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export class GrokTuiComponent {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly done: () => void;
	private readonly store: GrokTranscriptStore;
	private readonly sendUserMessage: (content: string) => void;
	private readonly input = new Input();
	private readonly unsubscribe: () => void;
	private scrollOffset = 0;
	private followTail = true;
	private disposed = false;

	constructor(
		tui: TUI,
		theme: Theme,
		store: GrokTranscriptStore,
		sendUserMessage: (content: string) => void,
		done: () => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.store = store;
		this.sendUserMessage = sendUserMessage;
		this.done = done;
		this.input.onSubmit = (value) => {
			const content = value.trim();
			if (!content) return;
			this.sendUserMessage(content);
			this.input.setValue("");
			this.followTail = true;
			this.tui.requestRender();
		};
		this.input.onEscape = () => this.close();
		this.unsubscribe = store.subscribe(() => {
			if (this.followTail) this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.tui.requestRender();
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe();
	}

	private close(): void {
		if (this.disposed) return;
		this.dispose();
		this.done();
	}

	private selectedIndex(): number {
		return this.store.state.selectedIndex;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.close();
			return;
		}
		if (matchesKey(data, "ctrl+o")) {
			toggleAll(this.store.state, "tool");
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "ctrl+t")) {
			toggleAll(this.store.state, "thinking");
			this.tui.requestRender();
			return;
		}

		const editorEmpty = this.input.getValue().length === 0;
		if (editorEmpty && matchesKey(data, "up")) {
			moveSelection(this.store.state, -1);
			this.followTail = false;
			this.tui.requestRender();
			return;
		}
		if (editorEmpty && matchesKey(data, "down")) {
			moveSelection(this.store.state, 1);
			this.followTail = false;
			this.tui.requestRender();
			return;
		}
		if (editorEmpty && matchesKey(data, "left")) {
			setBlockExpanded(this.store.state, this.selectedIndex(), false);
			this.tui.requestRender();
			return;
		}
		if (editorEmpty && matchesKey(data, "right")) {
			setBlockExpanded(this.store.state, this.selectedIndex(), true);
			this.tui.requestRender();
			return;
		}
		if (editorEmpty && matchesKey(data, "enter")) {
			toggleBlock(this.store.state, this.selectedIndex());
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "pageup") || matchesKey(data, "ctrl+u")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.pageSize());
			this.followTail = false;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "pagedown") || matchesKey(data, "ctrl+d")) {
			this.scrollOffset += this.pageSize();
			this.followTail = false;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.followTail = false;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "end")) {
			this.followTail = true;
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.tui.requestRender();
			return;
		}

		this.input.handleInput(data);
		this.tui.requestRender();
	}

	private pageSize(): number {
		return Math.max(4, (this.tui.terminal.rows || 24) - 8);
	}

	private renderBlock(block: GrokState["blocks"][number], width: number, selected: boolean): string[] {
		const th = this.theme;
		const marker = selected ? th.fg("accent", "›") : " ";
		const icon = statusIcon(block.status);
		const label = kindLabel(block.kind);
		const duration = formatDuration(block.startedAt, block.endedAt);
		const meta = [block.status, duration].filter(Boolean).join(" · ");
		const summary = oneLine(block.summary || block.body || label);
		const header = `${marker} ${th.fg(selected ? "accent" : "muted", icon)} ${th.fg(selected ? "accent" : "toolTitle", label)} ${th.fg("text", truncateToWidth(summary, Math.max(10, width - 28), "..."))} ${th.fg("dim", meta)}`;
		const lines = [header];
		if (!block.expanded || !block.body || (block.kind !== "thinking" && block.kind !== "tool" && block.kind !== "user" && block.kind !== "assistant")) return lines;
		if (block.kind === "tool") {
			if (block.command) {
				lines.push(`  ${th.fg("muted", "command")}`);
				lines.push(...wrapLines(block.command, Math.max(8, width - 4)).map((line) => `    ${th.fg("accent", line)}`));
			}
			if (block.body && block.body !== block.command) {
				lines.push(`  ${th.fg("muted", "output")}`);
				lines.push(...wrapLines(block.body, Math.max(8, width - 4)).map((line) => `    ${th.fg(block.status === "error" ? "error" : "toolOutput", line)}`));
			}
			if (block.errorMessage && block.errorMessage !== block.body) lines.push(`  ${th.fg("error", block.errorMessage)}`);
			return lines;
		}
		lines.push(...wrapLines(block.body, Math.max(8, width - 2)).map((line) => `  ${th.fg(block.kind === "thinking" ? "muted" : "text", line)}`));
		return lines;
	}

	private buildTranscript(width: number): { lines: string[]; selectedLine: number } {
		const lines: string[] = [];
		let selectedLine = 0;
		const state = this.store.state;
		for (let index = 0; index < state.blocks.length; index++) {
			const block = state.blocks[index]!;
			if (index === state.selectedIndex) selectedLine = lines.length;
			lines.push(...this.renderBlock(block, width, index === state.selectedIndex));
			lines.push("");
		}
		return { lines, selectedLine };
	}

	render(width: number): string[] {
		const th = this.theme;
		const inner = Math.max(20, width - 2);
		const pageSize = this.pageSize();
		const transcript = this.buildTranscript(inner - 2);
		const maxScroll = Math.max(0, transcript.lines.length - pageSize);
		if (this.followTail) this.scrollOffset = maxScroll;
		this.scrollOffset = Math.max(0, Math.min(maxScroll, this.scrollOffset));
		if (!this.followTail && transcript.selectedLine < this.scrollOffset) this.scrollOffset = transcript.selectedLine;
		if (!this.followTail && transcript.selectedLine >= this.scrollOffset + pageSize) this.scrollOffset = transcript.selectedLine - pageSize + 1;

		const visible = transcript.lines.slice(this.scrollOffset, this.scrollOffset + pageSize);
		while (visible.length < pageSize) visible.push("");
		const title = ` Grok TUI · ${this.store.state.blocks.length} blocks · ${this.store.state.selectedIndex + 1}/${Math.max(1, this.store.state.blocks.length)} `;
		const clippedTitle = truncateToWidth(title, inner, "...", true);
		const titleWidth = visibleWidth(clippedTitle);
		const left = Math.max(0, Math.floor((inner - titleWidth) / 2));
		const right = Math.max(0, inner - titleWidth - left);
		const border = (text: string) => th.fg("border", text);
		const body = (text: string) => `${border("│")}${fit(text, inner)}${border("│")}`;
		const inputLines = this.input.render(Math.max(8, inner - 4));
		const inputText = inputLines[0] ?? "";
		return [
			border(`╭${"─".repeat(left)}`) + th.fg("accent", clippedTitle) + border(`${"─".repeat(right)}╮`),
			body(` ${th.fg("dim", this.followTail ? "following output" : "paused · End resumes follow")}`),
			...visible.map((line) => body(line)),
			body(border("─".repeat(inner))),
			body(` ${th.fg("accent", "›")} ${fit(inputText, Math.max(1, inner - 4))}`),
			body(` ${th.fg("dim", "↑↓/j/k select · ←/→ fold · Enter toggle · Ctrl+O tools · Ctrl+T thinking")}`),
			body(` ${th.fg("dim", "PgUp/PgDn scroll · Home/End · Esc close · prompt Enter send")}`),
			border(`╰${"─".repeat(inner)}╯`),
		];
	}
}

export async function openGrokTui(ctx: ExtensionCommandContext, store: GrokTranscriptStore): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify("Grok TUI requires interactive TUI mode.", "warning");
		return;
	}
	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			let component!: GrokTuiComponent;
			component = new GrokTuiComponent(tui, theme, store, (content) => ctx.sendUserMessage(content), () => {
				component.dispose();
				done(undefined);
			});
			return component;
		},
		{ overlay: false },
	);
}
