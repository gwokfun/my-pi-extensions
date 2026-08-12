import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashTool, createEditTool, createFindTool, createGrepTool, createLsTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { ToolCollapseAdapter } from "./format.ts";
import { registerToolAdapter } from "./format.ts";
import { renderCollapsedCall, renderCollapsedResult } from "./render.ts";
import { aggregationStore } from "./aggregate.ts";

export { registerToolAdapter } from "./format.ts";
export type { ToolCollapseAdapter } from "./format.ts";

export function withCollapsedRendering<T extends ToolDefinition>(tool: T, adapter?: ToolCollapseAdapter): T {
	if (adapter) registerToolAdapter(adapter);
	return {
		...tool,
		renderShell: "self",
		renderCall: (args, theme, context) => renderCollapsedCall(tool.name, args, theme, context),
		renderResult: (result, options, theme, context) => renderCollapsedResult(tool.name, context.args, result, options, theme, context),

	} as T;
}

export default function quietTools(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const tools = [createReadTool(cwd), createBashTool(cwd), createEditTool(cwd), createWriteTool(cwd), createFindTool(cwd), createGrepTool(cwd), createLsTool(cwd)];
	for (const tool of tools) pi.registerTool(withCollapsedRendering(tool as ToolDefinition));

	pi.registerShortcut(Key.ctrl("o"), {
		description: "Expand/collapse the current tool group",
		handler: () => aggregationStore.toggleGroup(),
	});
	pi.registerShortcut(Key.ctrl("j"), {
		description: "Select next tool in the current group",
		handler: () => aggregationStore.move(1),
	});
	pi.registerShortcut(Key.ctrl("k"), {
		description: "Select previous tool in the current group",
		handler: () => aggregationStore.move(-1),
	});
	pi.registerShortcut(Key.ctrlShift("j"), {
		description: "Select next aggregate tool group",
		handler: () => aggregationStore.moveGroup(1),
	});
	pi.registerShortcut(Key.ctrlShift("k"), {
		description: "Select previous aggregate tool group",
		handler: () => aggregationStore.moveGroup(-1),
	});
	pi.registerShortcut(Key.ctrl("e"), {
		description: "Expand/collapse the selected tool details",
		handler: () => aggregationStore.toggleCall(),
	});
	pi.on("turn_start", () => aggregationStore.beginTurn());
	pi.on("agent_settled", () => aggregationStore.endTurn());
	pi.on("session_start", (_event, ctx) => {
		aggregationStore.reset();
		// This label is safe in RPC/non-interactive mode; no settings file is changed.
		ctx.ui.setHiddenThinkingLabel("thinking hidden (configure hideThinkingBlock to collapse)");
	});
}
