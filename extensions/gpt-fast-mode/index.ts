import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	COMMAND_NAME,
	COMMAND_USAGE,
	FLAG_NAME,
	FastCommandError,
	FastState,
	formatModel,
	getCommandCompletions,
	injectPriorityTier,
	readHandoff,
	SERVICE_TIER,
	STATUS_KEY,
	writeHandoff,
	parseFastCommand,
} from "./logic.ts";

function notify(ctx: ExtensionContext | ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

export default function gptFastModeExtension(pi: ExtensionAPI): void {
	const state = new FastState();

	function currentModel(ctx: { model?: unknown }): unknown {
		return ctx.model;
	}

	function refreshIndicator(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!state.isDesired()) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, state.isActive() ? "fast" : "fast⇢");
	}

	function reportStatus(ctx: ExtensionCommandContext): void {
		const model = currentModel(ctx);
		if (!state.isDesired()) {
			notify(ctx, `Fast Mode is OFF (tier would be "${SERVICE_TIER}")`, "info");
			return;
		}
		if (state.isActive()) {
			notify(ctx, `Fast Mode is ON — requesting "${SERVICE_TIER}" on ${formatModel(model)}`, "info");
			return;
		}
		notify(
			ctx,
			`Fast Mode is ON and handed off to subagents ("${SERVICE_TIER}"). ${formatModel(model)} is not a supported GPT model, so this session will not modify its request.`,
			"info",
		);
	}

	function announce(ctx: ExtensionCommandContext): void {
		if (!state.isDesired()) {
			notify(ctx, "Fast Mode disabled", "info");
			return;
		}
		if (state.isActive()) {
			notify(ctx, `Fast Mode enabled — service tier "${SERVICE_TIER}"`, "info");
			return;
		}
		notify(ctx, `Fast Mode enabled and handed off to subagents; ${formatModel(ctx.model)} is not a supported GPT model.`, "info");
	}

	pi.registerFlag(FLAG_NAME, {
		description: "Start with GPT Fast Mode enabled",
		type: "boolean",
		default: false,
	});

	pi.registerCommand(COMMAND_NAME, {
		description: `Control GPT Fast Mode. ${COMMAND_USAGE}`,
		getArgumentCompletions: getCommandCompletions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				state.setModel(currentModel(ctx));
				const action = parseFastCommand(args);
				if (action.kind === "status") {
					reportStatus(ctx);
					return;
				}
				if (action.kind === "toggle") state.toggle();
				else state.setDesired(action.desired);
				writeHandoff(state.isDesired());
				refreshIndicator(ctx);
				announce(ctx);
			} catch (error) {
				if (error instanceof FastCommandError) notify(ctx, error.message, "warning");
				else notify(ctx, error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		state.setModel(currentModel(ctx));
		const flagEnabled = pi.getFlag(FLAG_NAME) === true;
		const handoff = readHandoff();
		state.setDesired(flagEnabled || (handoff ?? false));
		writeHandoff(state.isDesired());
		refreshIndicator(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		state.setModel(event.model ?? currentModel(ctx));
		refreshIndicator(ctx);
	});

	pi.on("before_provider_request", (event, ctx) => {
		state.setModel(currentModel(ctx));
		if (!state.isActive()) return undefined;
		const next = injectPriorityTier(event.payload);
		return next === event.payload ? undefined : next;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
