import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	cloneSnapshotForSession,
	emptySnapshot,
	getPlanCommandCompletions,
	getToolsForPhase,
	hashPlanContent,
	isRestrictedPhase,
	isSettlingPhase,
	isToolAllowed,
	isTrustedPlanTool,
	latestSnapshotFromEntries,
	MAX_PLAN_BYTES,
	nowIso,
	parsePlanCommand,
	PLAN_ENTRY_TYPE,
	planToolIntegrityIssues,
	planSummary,
	restoreTools,
	sessionPlanPath,
	startPlanningSnapshot,
	STATUS_KEY,
	SUBMIT_PLAN_TOOL,
	type PlanDecision,
	type PlanModeSnapshot,
	validatePlanContent,
	WRITE_PLAN_TOOL,
} from "./logic.ts";
import { readPlanArtifact, writePlanArtifact } from "./storage.ts";
import { openPlanViewer, type PlanViewerAction } from "./viewer.ts";

type AnyContext = ExtensionContext | ExtensionCommandContext;

interface ReviewResult {
	action: PlanViewerAction;
	feedback?: string;
}

interface SubmitPlanDetails {
	action: PlanViewerAction | "error";
	planPath: string;
	revision: number;
}

const PLAN_SYSTEM_PROMPT = `
## Plan Mode

Plan Mode is active. Explore the actual repository and produce a decision-complete implementation plan before any implementation.

Rules:
- Do not modify project files or attempt to use unavailable tools.
- Use read, grep, find, and ls for repository exploration.
- Ask only questions that cannot be answered from the repository.
- Maintain the complete plan through the write_plan tool. Do not merely print the plan in chat.
- The plan must include Summary, Implementation Changes, Public APIs or Interfaces, Test Plan, and Assumptions.
- When the plan is complete, call submit_plan as the only and final tool call in that assistant message.
- If submit_plan returns revision feedback, rewrite the complete plan and submit it again.
- If the plan is approved, stop immediately and wait for the run to settle. Do not begin implementation.
`;

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

export default function piPlanModeExtension(pi: ExtensionAPI): void {
	let state = emptySnapshot("unbound");
	let activeReviewToken: string | null = null;

	function allToolNames(): string[] {
		return pi.getAllTools().map((tool) => tool.name);
	}

	function toolIntegrityIssues(): string[] {
		return planToolIntegrityIssues(pi.getAllTools(), EXTENSION_DIR);
	}

	function currentPlanPath(ctx: AnyContext): string {
		return sessionPlanPath(ctx.sessionManager.getSessionDir(), ctx.sessionManager.getSessionId());
	}

	function persistState(): void {
		pi.appendEntry<PlanModeSnapshot>(PLAN_ENTRY_TYPE, {
			...state,
			originalActiveTools: [...state.originalActiveTools],
			planAddedTools: [...state.planAddedTools],
		});
	}

	function updateStatus(ctx: AnyContext): void {
		if (!ctx.hasUI) return;
		let text: string | undefined;
		switch (state.phase) {
			case "planning":
				text = ctx.ui.theme.fg("warning", `plan r${state.revision}`);
				break;
			case "awaiting_approval":
				text = ctx.ui.theme.fg("accent", "plan review");
				break;
			case "approved_settling":
			case "abandoned_settling":
				text = ctx.ui.theme.fg("muted", "plan settling");
				break;
			default:
				text = undefined;
		}
		ctx.ui.setStatus(STATUS_KEY, text);
	}

	function applyRestrictedTools(): void {
		if (!isRestrictedPhase(state.phase)) return;
		const tools = pi.getAllTools();
		const trustedNames = new Set(
			tools.filter((tool) => isTrustedPlanTool(tool, EXTENSION_DIR)).map((tool) => tool.name),
		);
		pi.setActiveTools(
			getToolsForPhase(
				state.phase,
				tools.map((tool) => tool.name),
			).filter((name) => trustedNames.has(name)),
		);
	}

	function restoreNormalTools(snapshot: PlanModeSnapshot): void {
		pi.setActiveTools(
			restoreTools(pi.getActiveTools(), snapshot.originalActiveTools, snapshot.planAddedTools, allToolNames()),
		);
	}

	function transition(phase: PlanModeSnapshot["phase"], ctx: AnyContext, decision?: PlanDecision): void {
		state = {
			...state,
			phase,
			decision,
			updatedAt: nowIso(),
		};
		persistState();
		applyRestrictedTools();
		updateStatus(ctx);
	}

	function finishInactive(ctx: AnyContext, decision?: PlanDecision): void {
		const previous = state;
		restoreNormalTools(previous);
		state = {
			...previous,
			phase: "inactive",
			decision: decision ?? previous.decision,
			originalActiveTools: [],
			planAddedTools: [],
			updatedAt: nowIso(),
		};
		persistState();
		updateStatus(ctx);
	}

	async function materializePlan(ctx: AnyContext, content = state.content): Promise<void> {
		await writePlanArtifact(currentPlanPath(ctx), content);
	}

	async function restoreFromCurrentBranch(ctx: AnyContext): Promise<void> {
		activeReviewToken = null;
		const prior = state;
		const sessionId = ctx.sessionManager.getSessionId();
		const saved = latestSnapshotFromEntries(ctx.sessionManager.getBranch());

		if (!saved) {
			if (isRestrictedPhase(prior.phase)) restoreNormalTools(prior);
			state = emptySnapshot(sessionId);
			await materializePlan(ctx, "");
			updateStatus(ctx);
			return;
		}

		if (saved.sessionId !== sessionId) {
			state = cloneSnapshotForSession({
				snapshot: saved,
				sessionId,
				planId: randomUUID(),
				originalActiveTools: pi.getActiveTools(),
				allToolNames: allToolNames(),
			});
			persistState();
		} else {
			if (isRestrictedPhase(prior.phase) && !isRestrictedPhase(saved.phase)) restoreNormalTools(prior);
			state = { ...saved, originalActiveTools: [...saved.originalActiveTools], planAddedTools: [...saved.planAddedTools] };
		}

		await materializePlan(ctx);
		if (isSettlingPhase(state.phase)) {
			finishInactive(ctx, state.decision);
			return;
		}
		applyRestrictedTools();
		updateStatus(ctx);
	}

	async function enterPlanMode(ctx: AnyContext): Promise<boolean> {
		if (ctx.mode !== "tui") {
			if (ctx.hasUI) ctx.ui.notify("Plan Mode can only be started in interactive TUI mode.", "warning");
			return false;
		}
		if (!ctx.isIdle()) {
			ctx.ui.notify("Wait for the current agent run to settle before entering Plan Mode.", "warning");
			return false;
		}
		if (state.phase !== "inactive") {
			const hint = state.phase === "awaiting_approval" ? " Use /plan review." : "";
			ctx.ui.notify(`Plan Mode is already ${state.phase}.${hint}`, "info");
			return state.phase === "planning";
		}
		const integrityIssues = toolIntegrityIssues();
		if (integrityIssues.length > 0) {
			ctx.ui.notify(
				`Plan Mode refused to start because protected tools are missing or shadowed: ${integrityIssues.join("; ")}`,
				"error",
			);
			return false;
		}

		state = startPlanningSnapshot({
			sessionId: ctx.sessionManager.getSessionId(),
			planId: randomUUID(),
			originalActiveTools: pi.getActiveTools(),
			allToolNames: allToolNames(),
		});
		persistState();
		await materializePlan(ctx, "");
		applyRestrictedTools();
		updateStatus(ctx);
		ctx.ui.notify("Plan Mode enabled. Project writes, shell, subagents, and unknown tools are disabled.", "info");
		return true;
	}

	async function runReviewUi(ctx: AnyContext): Promise<ReviewResult> {
		if (ctx.mode !== "tui") throw new Error("Plan approval requires interactive TUI mode.");
		if (activeReviewToken) throw new Error("A plan review is already open.");
		const token = randomUUID();
		activeReviewToken = token;
		try {
			while (true) {
				const action = await openPlanViewer(ctx, {
					content: state.content,
					planPath: currentPlanPath(ctx),
					revision: state.revision,
					interactive: true,
				});
				if (activeReviewToken !== token) return { action: "dismiss" };
				if (action === "abandon") {
					const confirmed = await ctx.ui.confirm(
						"Abandon this plan?",
						"The plan file will be kept, but Plan Mode will end without approval.",
					);
					if (!confirmed) continue;
					return { action };
				}
				if (action === "revise") {
					const feedback = await ctx.ui.editor("Plan revision feedback", "");
					if (!feedback?.trim()) continue;
					return { action, feedback: feedback.trim() };
				}
				return { action };
			}
		} finally {
			if (activeReviewToken === token) activeReviewToken = null;
		}
	}

	async function syncPlanFromDisk(ctx: AnyContext): Promise<void> {
		const diskContent = validatePlanContent(await readPlanArtifact(currentPlanPath(ctx)));
		const diskHash = hashPlanContent(diskContent);
		if (diskHash === state.contentHash) return;
		state = {
			...state,
			revision: state.revision + 1,
			content: diskContent,
			contentHash: diskHash,
			decision: undefined,
			updatedAt: nowIso(),
		};
		persistState();
	}

	async function handleCommandReview(ctx: ExtensionCommandContext): Promise<void> {
		if (state.phase !== "awaiting_approval") {
			ctx.ui.notify("No plan is waiting for approval.", "info");
			return;
		}
		if (!ctx.isIdle()) {
			ctx.ui.notify("Wait for the current agent run to settle before reopening approval.", "warning");
			return;
		}
		try {
			await syncPlanFromDisk(ctx);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return;
		}

		const result = await runReviewUi(ctx);
		if (result.action === "approve") {
			finishInactive(ctx, "approved");
			ctx.ui.notify("Plan approved. Normal tools restored; waiting for your implementation instruction.", "info");
		} else if (result.action === "abandon") {
			finishInactive(ctx, "abandoned");
			ctx.ui.notify("Plan abandoned. Normal tools restored.", "info");
		} else if (result.action === "revise" && result.feedback) {
			transition("planning", ctx);
			pi.sendUserMessage(`Revise the current plan using this feedback:\n\n${result.feedback}`);
		}
	}

	pi.registerTool({
		name: WRITE_PLAN_TOOL,
		label: "Write Plan",
		description: `Replace the current session plan.md with a complete Markdown implementation plan. Maximum ${MAX_PLAN_BYTES} bytes.`,
		promptSnippet: "Write or replace the current Plan Mode plan.md",
		promptGuidelines: ["Use write_plan for the complete plan; it is the only write operation allowed in Plan Mode."],
		parameters: Type.Object({
			content: Type.String({ description: "Complete Markdown content for plan.md" }),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				if (state.phase !== "planning" || !state.planId) {
					throw new Error("write_plan is only available while actively planning.");
				}
				const content = validatePlanContent(params.content);
				await writePlanArtifact(currentPlanPath(ctx), content);
				state = {
					...state,
					revision: state.revision + 1,
					content,
					contentHash: hashPlanContent(content),
					decision: undefined,
					updatedAt: nowIso(),
				};
				persistState();
				updateStatus(ctx);
				return {
					content: [
						{
							type: "text" as const,
							text: `Saved plan revision ${state.revision}: ${planSummary(content)}\n${currentPlanPath(ctx)}`,
						},
					],
					details: {
						planPath: currentPlanPath(ctx),
						revision: state.revision,
						bytes: Buffer.byteLength(content, "utf8"),
						hash: state.contentHash,
					},
				};
			} catch (error) {
				return {
					content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
					details: { planPath: currentPlanPath(ctx), revision: state.revision },
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: SUBMIT_PLAN_TOOL,
		label: "Submit Plan",
		description: "Validate plan.md and open the blocking Plan Mode approval page. Call this alone as the final tool call.",
		promptSnippet: "Submit plan.md for user approval as the final tool call",
		promptGuidelines: ["Call submit_plan alone, after write_plan has saved a complete plan."],
		parameters: Type.Object({}),
		executionMode: "sequential",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const details = (): SubmitPlanDetails => ({
				action: "error",
				planPath: currentPlanPath(ctx),
				revision: state.revision,
			});
			try {
				if (state.phase !== "planning") throw new Error("submit_plan is only available while actively planning.");
				if (ctx.mode !== "tui") {
					throw new Error(`Plan approval requires interactive TUI mode. Plan remains locked at ${currentPlanPath(ctx)}.`);
				}
				await syncPlanFromDisk(ctx);
				transition("awaiting_approval", ctx);
				const result = await runReviewUi(ctx);

				if (result.action === "approve") {
					transition("approved_settling", ctx, "approved");
					return {
						content: [
							{
								type: "text" as const,
								text: "Plan approved. Stop now. Normal tools will be restored only after the agent run settles.",
							},
						],
						details: { ...details(), action: "approve", revision: state.revision },
						terminate: true,
					};
				}

				if (result.action === "abandon") {
					transition("abandoned_settling", ctx, "abandoned");
					return {
						content: [{ type: "text" as const, text: "Plan abandoned. Stop now; the plan file has been preserved." }],
						details: { ...details(), action: "abandon", revision: state.revision },
						terminate: true,
					};
				}

				if (result.action === "revise" && result.feedback) {
					transition("planning", ctx);
					return {
						content: [
							{
								type: "text" as const,
								text: `The user requested plan revisions:\n\n${result.feedback}\n\nRewrite the complete plan with write_plan, then call submit_plan again.`,
							},
						],
						details: { ...details(), action: "revise", revision: state.revision },
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: "Plan review closed without a decision. Approval remains pending; stop and wait for /plan review.",
						},
					],
					details: { ...details(), action: "dismiss", revision: state.revision },
					terminate: true,
				};
			} catch (error) {
				return {
					content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
					details: details(),
					isError: true,
					terminate: true,
				};
			}
		},
	});

	pi.registerCommand("plan", {
		description: "Enter Plan Mode, inspect status, review, or abandon: /plan [task|status|review|off]",
		getArgumentCompletions: getPlanCommandCompletions,
		handler: async (args, ctx) => {
			const command = parsePlanCommand(args);
			if (command.kind === "status") {
				ctx.ui.notify(
					`Plan Mode: ${state.phase}; revision ${state.revision}; ${currentPlanPath(ctx)}`,
					"info",
				);
				return;
			}
			if (command.kind === "review") {
				await handleCommandReview(ctx);
				return;
			}
			if (command.kind === "off") {
				if (state.phase === "inactive") {
					ctx.ui.notify("Plan Mode is already inactive.", "info");
					return;
				}
				if (!ctx.isIdle()) {
					ctx.ui.notify("Wait for the current agent run to settle before abandoning Plan Mode.", "warning");
					return;
				}
				const confirmed =
					!state.content || (await ctx.ui.confirm("Abandon Plan Mode?", "The plan file will be kept for later viewing."));
				if (!confirmed) return;
				finishInactive(ctx, "abandoned");
				ctx.ui.notify("Plan Mode abandoned. Normal tools restored.", "info");
				return;
			}

			const entered = await enterPlanMode(ctx);
			if (entered && command.task) pi.sendUserMessage(command.task);
		},
	});

	pi.registerCommand("view-plan", {
		description: "Open the current branch plan.md in a read-only Markdown preview",
		handler: async (_args, ctx) => {
			if (!state.content.trim()) {
				ctx.ui.notify("No plan is available on the current session branch.", "info");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify(`Plan preview requires TUI mode. Plan: ${currentPlanPath(ctx)}`, "warning");
				return;
			}
			await materializePlan(ctx);
			await openPlanViewer(ctx, {
				content: state.content,
				planPath: currentPlanPath(ctx),
				revision: state.revision,
				interactive: false,
			});
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Enter Plan Mode",
		handler: async (ctx) => {
			if (state.phase !== "inactive") {
				ctx.ui.notify(`Plan Mode is ${state.phase}. Use /plan off to exit explicitly.`, "info");
				return;
			}
			await enterPlanMode(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await restoreFromCurrentBranch(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await restoreFromCurrentBranch(ctx);
	});

	pi.on("before_agent_start", (event) => {
		if (!isRestrictedPhase(state.phase)) return;
		const integrityIssues = toolIntegrityIssues();
		if (integrityIssues.length > 0) {
			pi.setActiveTools([]);
			return {
				systemPrompt:
					`${event.systemPrompt}\n\nPlan Mode is locked because a protected tool is missing or shadowed. ` +
					"Do not call tools or implement the plan. Ask the user to resolve the tool collision or run /plan off.",
			};
		}
		applyRestrictedTools();
		if (state.phase === "planning") {
			return { systemPrompt: `${event.systemPrompt}\n\n${PLAN_SYSTEM_PROMPT}` };
		}
		return {
			systemPrompt: `${event.systemPrompt}\n\nPlan approval is pending. Do not modify the plan or implement it. Ask the user to run /plan review.`,
		};
	});

	pi.on("tool_call", (event) => {
		if (!isRestrictedPhase(state.phase)) return;
		const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
		if (tool && isToolAllowed(state.phase, event.toolName) && isTrustedPlanTool(tool, EXTENSION_DIR)) return;
		return {
			block: true,
			reason: `Plan Mode (${state.phase}) blocked tool "${event.toolName}". Only trusted Plan Mode tools are allowed.`,
			terminate: true,
		};
	});

	pi.on("user_bash", () => {
		if (!isRestrictedPhase(state.phase)) return;
		return {
			result: {
				output: `Plan Mode (${state.phase}) blocks direct shell commands.`,
				exitCode: 1,
				cancelled: false,
				truncated: false,
			},
		};
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (state.phase === "approved_settling") finishInactive(ctx, "approved");
		else if (state.phase === "abandoned_settling") finishInactive(ctx, "abandoned");
	});

	pi.on("session_shutdown", (_event, ctx) => {
		activeReviewToken = null;
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
