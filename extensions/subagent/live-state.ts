/**
 * Live run registry for subagent viewer (Scheme B).
 * Tool execute updates this; the overlay viewer subscribes and re-renders.
 */

import type { Message } from "@earendil-works/pi-ai";

export type RunMode = "single" | "parallel" | "chain";
export type RunStatus = "running" | "completed" | "failed";
export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TimelineItem {
	kind: "tool" | "text";
	/** Short display line (already truncated). */
	text: string;
	at: number;
}

export interface LiveTask {
	index: number;
	agent: string;
	agentSource: string;
	task: string;
	status: TaskStatus;
	model?: string;
	thinking?: string;
	timeline: TimelineItem[];
	latestText: string;
	errorMessage?: string;
	step?: number;
	exitCode?: number;
	startedAt: number;
	updatedAt: number;
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens: number;
		turns: number;
	};
}

export interface LiveRun {
	id: string;
	mode: RunMode;
	status: RunStatus;
	tasks: LiveTask[];
	startedAt: number;
	updatedAt: number;
}

/** Minimal shape synced from tool details (avoids circular import with index). */
export interface SyncResultLike {
	agent: string;
	agentSource?: string;
	task: string;
	exitCode: number;
	messages: Message[];
	model?: string;
	thinking?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens: number;
		turns: number;
	};
}

const MAX_TIMELINE_ITEMS = 120;
const MAX_TEXT_CHARS = 800;
const MAX_TOOL_ARG_CHARS = 120;

export type LiveRunListener = (run: LiveRun | null) => void;

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}

function oneLine(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

export function messagesToTimeline(messages: Message[]): TimelineItem[] {
	const items: TimelineItem[] = [];
	const now = Date.now();
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text" && part.text?.trim()) {
				items.push({
					kind: "text",
					text: truncate(part.text.trim(), MAX_TEXT_CHARS),
					at: now,
				});
			} else if (part.type === "toolCall") {
				const args = part.arguments ?? {};
				const preview = oneLine(JSON.stringify(args));
				items.push({
					kind: "tool",
					text: `${part.name} ${truncate(preview, MAX_TOOL_ARG_CHARS)}`,
					at: now,
				});
			}
		}
	}
	if (items.length > MAX_TIMELINE_ITEMS) {
		return items.slice(-MAX_TIMELINE_ITEMS);
	}
	return items;
}

function taskStatusFromResult(r: SyncResultLike): TaskStatus {
	if (r.exitCode === -1) return "running";
	if (r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted") return "failed";
	return "completed";
}

function resultToLiveTask(r: SyncResultLike, index: number, prev?: LiveTask): LiveTask {
	const timeline = messagesToTimeline(r.messages);
	const latestText =
		[...timeline].reverse().find((t) => t.kind === "text")?.text ??
		prev?.latestText ??
		"";
	const now = Date.now();
	return {
		index,
		agent: r.agent,
		agentSource: r.agentSource ?? "unknown",
		task: r.task,
		status: taskStatusFromResult(r),
		model: r.model,
		thinking: r.thinking,
		timeline,
		latestText,
		errorMessage: r.errorMessage,
		step: r.step,
		exitCode: r.exitCode,
		startedAt: prev?.startedAt ?? now,
		updatedAt: now,
		usage: r.usage,
	};
}

export class LiveRunRegistry {
	private runs = new Map<string, LiveRun>();
	private latestId: string | null = null;
	private listeners = new Set<LiveRunListener>();
	private viewerOpen = false;

	isViewerOpen(): boolean {
		return this.viewerOpen;
	}

	setViewerOpen(open: boolean): void {
		this.viewerOpen = open;
	}

	subscribe(listener: LiveRunListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(run: LiveRun | null): void {
		for (const listener of this.listeners) {
			try {
				listener(run);
			} catch {
				/* ignore subscriber errors */
			}
		}
	}

	startRun(
		id: string,
		mode: RunMode,
		seedTasks: Array<{ agent: string; task: string; step?: number }>,
	): LiveRun {
		const now = Date.now();
		const tasks: LiveTask[] = seedTasks.map((t, index) => ({
			index,
			agent: t.agent,
			agentSource: "unknown",
			task: t.task,
			status: "pending" as TaskStatus,
			timeline: [],
			latestText: "",
			step: t.step,
			exitCode: -1,
			startedAt: now,
			updatedAt: now,
		}));
		const run: LiveRun = {
			id,
			mode,
			status: "running",
			tasks,
			startedAt: now,
			updatedAt: now,
		};
		this.runs.set(id, run);
		this.latestId = id;
		// Keep only a few historical runs in memory
		if (this.runs.size > 8) {
			const ids = [...this.runs.keys()];
			for (const old of ids.slice(0, ids.length - 8)) {
				if (old !== id) this.runs.delete(old);
			}
		}
		this.emit(run);
		return run;
	}

	syncFromResults(id: string, mode: RunMode, results: SyncResultLike[]): void {
		const prev = this.runs.get(id);
		const now = Date.now();
		const tasks = results.map((r, index) => resultToLiveTask(r, index, prev?.tasks[index]));
		// Chain/partial updates may send fewer results than seeded tasks — keep pending tail.
		if (prev && prev.tasks.length > tasks.length) {
			for (let i = tasks.length; i < prev.tasks.length; i++) {
				const kept = prev.tasks[i]!;
				tasks.push({
					...kept,
					status: kept.status === "completed" || kept.status === "failed" ? kept.status : "pending",
					updatedAt: now,
				});
			}
		}
		const anyRunning = tasks.some((t) => t.status === "pending" || t.status === "running");
		const anyFailed = tasks.some((t) => t.status === "failed");
		const run: LiveRun = {
			id,
			mode,
			status: anyRunning ? "running" : anyFailed ? "failed" : "completed",
			tasks,
			startedAt: prev?.startedAt ?? now,
			updatedAt: now,
		};
		this.runs.set(id, run);
		this.latestId = id;
		this.emit(run);
	}

	finishRun(id: string, status: RunStatus = "completed"): void {
		const run = this.runs.get(id);
		if (!run) return;
		run.status = status;
		run.updatedAt = Date.now();
		for (const t of run.tasks) {
			if (t.status === "pending" || t.status === "running") {
				t.status = status === "failed" ? "failed" : "completed";
				t.updatedAt = run.updatedAt;
			}
		}
		this.emit(run);
	}

	getRun(id: string): LiveRun | null {
		return this.runs.get(id) ?? null;
	}

	getLatestRun(): LiveRun | null {
		if (!this.latestId) return null;
		return this.runs.get(this.latestId) ?? null;
	}

	/** Prefer an active (running) run; else latest. */
	getViewTarget(): LiveRun | null {
		for (const run of this.runs.values()) {
			if (run.status === "running") return run;
		}
		return this.getLatestRun();
	}
}

/** Process-wide singleton for the extension. */
export const liveRuns = new LiveRunRegistry();
