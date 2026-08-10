/**
 * Fullscreen-centered overlay viewer for live subagent runs (Scheme B).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { LiveRun, LiveTask } from "./live-state.ts";
import { liveRuns } from "./live-state.ts";

function statusIcon(status: LiveTask["status"] | LiveRun["status"]): string {
	switch (status) {
		case "running":
		case "pending":
			return "⏳";
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		default:
			return "·";
	}
}

function formatElapsed(startedAt: number, updatedAt: number, running: boolean): string {
	const end = running ? Date.now() : updatedAt;
	const sec = Math.max(0, Math.round((end - startedAt) / 1000));
	if (sec < 60) return `${sec}s`;
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return `${m}m${s.toString().padStart(2, "0")}s`;
}

function formatUsage(task: LiveTask): string {
	const u = task.usage;
	if (!u) return "";
	const parts: string[] = [];
	if (u.turns) parts.push(`${u.turns}t`);
	if (u.input) parts.push(`↑${u.input}`);
	if (u.output) parts.push(`↓${u.output}`);
	if (task.model) parts.push(task.model);
	if (task.thinking) parts.push(`think:${task.thinking}`);
	return parts.join(" ");
}

export class SubagentViewerComponent {
	private theme: Theme;
	private tui: TUI;
	private done: () => void;
	private selected = 0;
	private scroll = 0;
	private unsubscribe: (() => void) | null = null;
	private tick: ReturnType<typeof setInterval> | null = null;
	private run: LiveRun | null;

	constructor(tui: TUI, theme: Theme, done: () => void, initialRun: LiveRun | null) {
		this.tui = tui;
		this.theme = theme;
		this.done = done;
		this.run = initialRun ?? liveRuns.getViewTarget();
		if (this.run && this.run.tasks.length > 0) {
			// Prefer first running task
			const runningIdx = this.run.tasks.findIndex((t) => t.status === "running" || t.status === "pending");
			this.selected = runningIdx >= 0 ? runningIdx : 0;
		}

		this.unsubscribe = liveRuns.subscribe((run) => {
			if (!run) return;
			// Follow active/latest updates for the same id, or switch to newer active run
			if (!this.run || run.id === this.run.id || run.status === "running") {
				this.run = run;
				if (this.selected >= run.tasks.length) {
					this.selected = Math.max(0, run.tasks.length - 1);
				}
				this.tui.requestRender();
			}
		});

		// Elapsed time tick while running
		this.tick = setInterval(() => {
			if (this.run?.status === "running") {
				this.tui.requestRender();
			}
		}, 1000);
	}

	dispose(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
		if (this.tick) {
			clearInterval(this.tick);
			this.tick = null;
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.dispose();
			this.done();
			return;
		}

		const n = this.run?.tasks.length ?? 0;
		if (n === 0) return;

		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.selected = (this.selected - 1 + n) % n;
			this.scroll = 0;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.selected = (this.selected + 1) % n;
			this.scroll = 0;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "pageup") || matchesKey(data, "ctrl+u")) {
			this.scroll = Math.max(0, this.scroll - 5);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "pagedown") || matchesKey(data, "ctrl+d")) {
			this.scroll += 5;
			this.tui.requestRender();
			return;
		}
		// Digit jump 1-9
		if (data.length === 1 && data >= "1" && data <= "9") {
			const idx = Number(data) - 1;
			if (idx < n) {
				this.selected = idx;
				this.scroll = 0;
				this.tui.requestRender();
			}
		}
	}

	private pad(line: string, innerW: number): string {
		return truncateToWidth(line, innerW, "...", true);
	}

	private frame(lines: string[], width: number, title: string): string[] {
		const th = this.theme;
		const innerW = Math.max(1, width - 2);
		const titleStr = truncateToWidth(` ${title} `, innerW);
		const titleW = visibleWidth(titleStr);
		const left = Math.floor((innerW - titleW) / 2);
		const right = Math.max(0, innerW - titleW - left);
		const out: string[] = [];
		out.push(th.fg("border", `╭${"─".repeat(left)}`) + th.fg("accent", titleStr) + th.fg("border", `${"─".repeat(right)}╮`));
		for (const line of lines) {
			out.push(th.fg("border", "│") + this.pad(line, innerW) + th.fg("border", "│"));
		}
		out.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));
		return out;
	}

	render(width: number): string[] {
		const th = this.theme;
		const run = this.run ?? liveRuns.getViewTarget();
		this.run = run;

		if (!run || run.tasks.length === 0) {
			return this.frame(
				[
					"",
					` ${th.fg("muted", "No subagent run to display.")}`,
					` ${th.fg("dim", "Run a subagent tool, then open this viewer again.")}`,
					"",
					` ${th.fg("dim", "Esc/q close")}`,
					"",
				],
				width,
				"Subagent Viewer",
			);
		}

		const task = run.tasks[this.selected] ?? run.tasks[0]!;
		const running = run.status === "running";
		const elapsed = formatElapsed(run.startedAt, run.updatedAt, running);
		const title = `Subagent Viewer · ${run.mode} · ${statusIcon(run.status)} ${run.status} · ${elapsed} · Esc/q`;

		const listWidth = Math.min(28, Math.max(18, Math.floor(width * 0.28)));
		const gap = 1;
		const rightWidth = Math.max(20, width - listWidth - gap - 2);
		// We'll render as stacked sections for simplicity (more reliable than dual columns with ANSI).

		const lines: string[] = [];
		lines.push("");
		lines.push(
			` ${th.fg("muted", "Tasks")} ${th.fg("dim", `(${this.selected + 1}/${run.tasks.length}) j/k switch · PgUp/PgDn scroll`)}`,
		);

		for (let i = 0; i < run.tasks.length; i++) {
			const t = run.tasks[i]!;
			const marker = i === this.selected ? th.fg("accent", "›") : " ";
			const icon = statusIcon(t.status);
			const label = `${i + 1}. ${t.agent}`;
			const meta = t.step != null ? ` step ${t.step}` : "";
			lines.push(` ${marker} ${icon} ${th.fg(i === this.selected ? "accent" : "toolOutput", label)}${th.fg("dim", meta)}`);
		}

		lines.push(` ${th.fg("border", "─".repeat(Math.max(8, Math.min(width - 4, 60))))}`);
		lines.push(
			` ${th.fg("toolTitle", th.bold(task.agent))}${th.fg("muted", ` (${task.agentSource})`)} ${statusIcon(task.status)} ${th.fg("dim", task.status)}`,
		);

		const taskPreview = oneLineLocal(task.task);
		lines.push(` ${th.fg("muted", "task:")} ${th.fg("dim", truncateToWidth(taskPreview, Math.max(10, width - 12), "..."))}`);

		const usage = formatUsage(task);
		if (usage) lines.push(` ${th.fg("dim", usage)}`);
		if (task.errorMessage) lines.push(` ${th.fg("error", `error: ${oneLineLocal(task.errorMessage)}`)}`);

		lines.push(` ${th.fg("muted", "── timeline ──")}`);

		const timeline = task.timeline;
		if (timeline.length === 0) {
			lines.push(
				` ${th.fg("muted", task.status === "running" || task.status === "pending" ? "(waiting for events…)" : "(no events)")}`,
			);
		} else {
			const maxBody = Math.max(6, Math.min(24, timeline.length));
			const maxScroll = Math.max(0, timeline.length - maxBody);
			if (this.scroll > maxScroll) this.scroll = maxScroll;
			const start = this.scroll;
			const slice = timeline.slice(start, start + maxBody);
			if (start > 0) {
				lines.push(` ${th.fg("muted", `… ${start} earlier`)}`);
			}
			for (const item of slice) {
				if (item.kind === "tool") {
					lines.push(` ${th.fg("muted", "→")} ${th.fg("accent", truncateToWidth(item.text, Math.max(10, width - 8), "..."))}`);
				} else {
					const textLines = item.text.split("\n").slice(0, 4);
					for (const tl of textLines) {
						lines.push(` ${th.fg("toolOutput", truncateToWidth(tl, Math.max(10, width - 6), "..."))}`);
					}
				}
			}
			const hidden = timeline.length - start - slice.length;
			if (hidden > 0) {
				lines.push(` ${th.fg("muted", `… ${hidden} more (PgDn)`)}`);
			}
		}

		if (task.latestText && task.timeline[task.timeline.length - 1]?.kind !== "text") {
			lines.push(` ${th.fg("muted", "── latest ──")}`);
			for (const tl of task.latestText.split("\n").slice(0, 3)) {
				lines.push(` ${th.fg("toolOutput", truncateToWidth(tl, Math.max(10, width - 6), "..."))}`);
			}
		}

		lines.push("");
		lines.push(
			` ${th.fg("dim", "Event-level updates (not token stream). Closing viewer does not stop subagents.")}`,
		);
		lines.push("");

		// silence unused var for column experiment
		void rightWidth;
		void listWidth;

		return this.frame(lines, width, title);
	}
}

function oneLineLocal(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/**
 * Open the subagent viewer overlay. Safe to call from command/shortcut handlers.
 * Does not block tool execute (separate async stack).
 */
export async function openSubagentViewer(ctx: {
	mode?: string;
	hasUI?: boolean;
	ui: {
		notify: (msg: string, level?: "info" | "warning" | "error") => void;
		custom: <T>(
			factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (value: T) => void) => unknown,
			options?: {
				overlay?: boolean;
				overlayOptions?: Record<string, unknown>;
			},
		) => Promise<T>;
	};
}): Promise<void> {
	if (ctx.mode !== undefined && ctx.mode !== "tui") {
		ctx.ui.notify("Subagent viewer requires interactive TUI mode", "warning");
		return;
	}
	if (ctx.hasUI === false) {
		ctx.ui.notify("Subagent viewer requires UI", "warning");
		return;
	}
	if (liveRuns.isViewerOpen()) {
		ctx.ui.notify("Subagent viewer is already open (Esc to close)", "info");
		return;
	}

	const run = liveRuns.getViewTarget();
	if (!run) {
		ctx.ui.notify("No subagent run yet. Invoke the subagent tool first.", "info");
		return;
	}

	liveRuns.setViewerOpen(true);
	try {
		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => {
				let component!: SubagentViewerComponent;
				component = new SubagentViewerComponent(
					tui,
					theme,
					() => {
						component.dispose();
						done(undefined);
					},
					run,
				);
				return component;
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: "92%",
					maxHeight: "88%",
					margin: { top: 1, bottom: 1 },
				},
			},
		);
	} catch (err) {
		ctx.ui.notify(`Subagent viewer failed: ${err instanceof Error ? err.message : String(err)}`, "error");
	} finally {
		liveRuns.setViewerOpen(false);
	}
}
