import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createGrokTranscriptStore, openGrokTui } from "./viewer.ts";
import type { GrokEventLike, SessionEntryLike } from "./model.ts";

function loadCurrentBranch(ctx: ExtensionContext | ExtensionCommandContext, store: ReturnType<typeof createGrokTranscriptStore>): void {
	store.loadBranch(ctx.sessionManager.getBranch() as unknown as SessionEntryLike[]);
}

export default function (pi: ExtensionAPI): void {
	const store = createGrokTranscriptStore();

	pi.registerCommand("grok-tui", {
		description: "Open the Grok-style structured transcript viewer (Esc closes)",
		handler: async (_args, ctx) => {
			loadCurrentBranch(ctx, store);
			await openGrokTui(ctx, store);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		loadCurrentBranch(ctx, store);
	});

	pi.on("session_tree", (_event, ctx) => {
		loadCurrentBranch(ctx, store);
	});

	const forward = (event: GrokEventLike): void => store.apply(event);
	pi.on("turn_start", forward);
	pi.on("message_start", forward);
	pi.on("message_update", forward);
	pi.on("message_end", forward);
	pi.on("tool_execution_start", forward);
	pi.on("tool_execution_update", forward);
	pi.on("tool_execution_end", forward);
	pi.on("agent_settled", forward);

	pi.on("session_shutdown", () => {
		store.loadBranch([]);
	});
}

