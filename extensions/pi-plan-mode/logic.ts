import { createHash } from "node:crypto";
import * as path from "node:path";

export const PLAN_ENTRY_TYPE = "pi-plan-mode-state";
export const STATUS_KEY = "pi-plan-mode";
export const WRITE_PLAN_TOOL = "write_plan";
export const SUBMIT_PLAN_TOOL = "submit_plan";
export const MAX_PLAN_BYTES = 256 * 1024;

export const PLAN_READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;

export interface PlanToolInfo {
	name: string;
	sourceInfo: {
		path: string;
		source: string;
		baseDir?: string;
	};
}

export type PlanModePhase =
	| "inactive"
	| "planning"
	| "awaiting_approval"
	| "approved_settling"
	| "abandoned_settling";

export type PlanDecision = "approved" | "abandoned";

export interface PlanModeSnapshot {
	version: 1;
	sessionId: string;
	phase: PlanModePhase;
	planId?: string;
	revision: number;
	content: string;
	contentHash: string;
	originalActiveTools: string[];
	planAddedTools: string[];
	decision?: PlanDecision;
	updatedAt: string;
}

export type PlanCommand =
	| { kind: "enter"; task?: string }
	| { kind: "off" }
	| { kind: "review" }
	| { kind: "status" };

export class PlanValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlanValidationError";
	}
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function normalizedPath(value: string): string {
	const resolved = path.resolve(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function nowIso(now = new Date()): string {
	return now.toISOString();
}

export function emptySnapshot(sessionId: string, updatedAt = nowIso()): PlanModeSnapshot {
	return {
		version: 1,
		sessionId,
		phase: "inactive",
		revision: 0,
		content: "",
		contentHash: hashPlanContent(""),
		originalActiveTools: [],
		planAddedTools: [],
		updatedAt,
	};
}

export function startPlanningSnapshot(options: {
	sessionId: string;
	planId: string;
	originalActiveTools: string[];
	allToolNames: string[];
	content?: string;
	revision?: number;
	updatedAt?: string;
}): PlanModeSnapshot {
	const content = options.content ?? "";
	const planTools = getToolsForPhase("planning", options.allToolNames);
	return {
		version: 1,
		sessionId: options.sessionId,
		phase: "planning",
		planId: options.planId,
		revision: options.revision ?? (content ? 1 : 0),
		content,
		contentHash: hashPlanContent(content),
		originalActiveTools: unique(options.originalActiveTools),
		planAddedTools: planTools.filter((name) => !options.originalActiveTools.includes(name)),
		updatedAt: options.updatedAt ?? nowIso(),
	};
}

export function cloneSnapshotForSession(options: {
	snapshot: PlanModeSnapshot;
	sessionId: string;
	planId: string;
	originalActiveTools: string[];
	allToolNames: string[];
	updatedAt?: string;
}): PlanModeSnapshot {
	const activeInParent = options.snapshot.phase !== "inactive";
	if (activeInParent) {
		return startPlanningSnapshot({
			sessionId: options.sessionId,
			planId: options.planId,
			originalActiveTools: options.originalActiveTools,
			allToolNames: options.allToolNames,
			content: options.snapshot.content,
			revision: options.snapshot.content ? 1 : 0,
			updatedAt: options.updatedAt,
		});
	}

	return {
		...options.snapshot,
		sessionId: options.sessionId,
		planId: options.snapshot.planId ? options.planId : undefined,
		phase: "inactive",
		originalActiveTools: [],
		planAddedTools: [],
		updatedAt: options.updatedAt ?? nowIso(),
	};
}

export function isRestrictedPhase(phase: PlanModePhase): boolean {
	return phase !== "inactive";
}

export function isSettlingPhase(phase: PlanModePhase): boolean {
	return phase === "approved_settling" || phase === "abandoned_settling";
}

export function getToolsForPhase(phase: PlanModePhase, allToolNames: readonly string[]): string[] {
	const available = new Set(allToolNames);
	const requested =
		phase === "planning"
			? [...PLAN_READ_ONLY_TOOLS, WRITE_PLAN_TOOL, SUBMIT_PLAN_TOOL]
			: phase === "inactive"
				? []
				: [...PLAN_READ_ONLY_TOOLS];
	return unique(requested).filter((name) => available.has(name));
}

export function isToolAllowed(phase: PlanModePhase, toolName: string): boolean {
	if (phase === "inactive") return true;
	if ((PLAN_READ_ONLY_TOOLS as readonly string[]).includes(toolName)) return true;
	return phase === "planning" && (toolName === WRITE_PLAN_TOOL || toolName === SUBMIT_PLAN_TOOL);
}

export function isTrustedPlanTool(tool: PlanToolInfo, extensionDir: string): boolean {
	if ((PLAN_READ_ONLY_TOOLS as readonly string[]).includes(tool.name)) {
		return tool.sourceInfo.source === "builtin" && tool.sourceInfo.path === `<builtin:${tool.name}>`;
	}
	if (tool.name === WRITE_PLAN_TOOL || tool.name === SUBMIT_PLAN_TOOL) {
		const sourceDirectory = tool.sourceInfo.baseDir ?? path.dirname(tool.sourceInfo.path);
		return tool.sourceInfo.source !== "builtin" && normalizedPath(sourceDirectory) === normalizedPath(extensionDir);
	}
	return false;
}

export function planToolIntegrityIssues(tools: readonly PlanToolInfo[], extensionDir: string): string[] {
	const reservedNames = new Set<string>([...PLAN_READ_ONLY_TOOLS, WRITE_PLAN_TOOL, SUBMIT_PLAN_TOOL]);
	const issues = tools
		.filter((tool) => reservedNames.has(tool.name) && !isTrustedPlanTool(tool, extensionDir))
		.map((tool) => `${tool.name} is provided by ${tool.sourceInfo.path || tool.sourceInfo.source}`);
	for (const required of [WRITE_PLAN_TOOL, SUBMIT_PLAN_TOOL]) {
		if (!tools.some((tool) => tool.name === required && isTrustedPlanTool(tool, extensionDir))) {
			issues.push(`${required} is missing or shadowed`);
		}
	}
	return unique(issues);
}

export function restoreTools(
	currentActiveTools: readonly string[],
	originalActiveTools: readonly string[],
	planAddedTools: readonly string[],
	allToolNames: readonly string[],
): string[] {
	const available = new Set(allToolNames);
	const planAdded = new Set(planAddedTools);
	return unique([...currentActiveTools.filter((name) => !planAdded.has(name)), ...originalActiveTools]).filter((name) =>
		available.has(name),
	);
}

export function normalizePlanContent(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n");
	return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function validatePlanContent(content: string): string {
	const normalized = normalizePlanContent(content);
	if (!normalized.trim()) throw new PlanValidationError("Plan is empty. Write a complete plan before submitting it.");
	const size = Buffer.byteLength(normalized, "utf8");
	if (size > MAX_PLAN_BYTES) {
		throw new PlanValidationError(`Plan is too large (${size} bytes). Maximum: ${MAX_PLAN_BYTES} bytes.`);
	}
	return normalized;
}

export function hashPlanContent(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

export function sessionPlanPath(sessionDir: string, sessionId: string): string {
	const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
	const directoryName = !safeSessionId || safeSessionId === "." || safeSessionId === ".." ? "session" : safeSessionId;
	return path.join(sessionDir, "pi-plan-mode", directoryName, "plan.md");
}

export function parsePlanCommand(args: string): PlanCommand {
	const trimmed = args.trim();
	const normalized = trimmed.toLowerCase();
	if (!trimmed) return { kind: "enter" };
	if (normalized === "off") return { kind: "off" };
	if (normalized === "review") return { kind: "review" };
	if (normalized === "status") return { kind: "status" };
	return { kind: "enter", task: trimmed };
}

export function getPlanCommandCompletions(prefix: string): { value: string; label: string }[] | null {
	const normalized = prefix.trim().toLowerCase();
	if (normalized.includes(" ")) return null;
	const labels: Record<string, string> = {
		off: "abandon the active plan",
		review: "reopen pending approval",
		status: "show plan mode status",
	};
	return ["off", "review", "status"]
		.filter((value) => value.startsWith(normalized))
		.map((value) => ({ value, label: `${value} — ${labels[value]}` }));
}

export function isPlanModeSnapshot(value: unknown): value is PlanModeSnapshot {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<PlanModeSnapshot>;
	return (
		candidate.version === 1 &&
		typeof candidate.sessionId === "string" &&
		["inactive", "planning", "awaiting_approval", "approved_settling", "abandoned_settling"].includes(
			candidate.phase ?? "",
		) &&
		typeof candidate.revision === "number" &&
		typeof candidate.content === "string" &&
		typeof candidate.contentHash === "string" &&
		Array.isArray(candidate.originalActiveTools) &&
		candidate.originalActiveTools.every((name) => typeof name === "string") &&
		Array.isArray(candidate.planAddedTools) &&
		candidate.planAddedTools.every((name) => typeof name === "string") &&
		(candidate.planId === undefined || typeof candidate.planId === "string") &&
		(candidate.decision === undefined || candidate.decision === "approved" || candidate.decision === "abandoned") &&
		typeof candidate.updatedAt === "string"
	);
}

export function latestSnapshotFromEntries(entries: readonly unknown[]): PlanModeSnapshot | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry?.type === "custom" && entry.customType === PLAN_ENTRY_TYPE && isPlanModeSnapshot(entry.data)) {
			return entry.data;
		}
	}
	return undefined;
}

export function planSummary(content: string, maxLength = 100): string {
	const firstMeaningfulLine = content
		.split("\n")
		.map((line) => line.replace(/^#+\s*/, "").trim())
		.find(Boolean);
	if (!firstMeaningfulLine) return "Untitled plan";
	return firstMeaningfulLine.length > maxLength
		? `${firstMeaningfulLine.slice(0, Math.max(1, maxLength - 3))}...`
		: firstMeaningfulLine;
}
