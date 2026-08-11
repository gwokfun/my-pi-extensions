export const COMMAND_NAME = "fast";
export const FLAG_NAME = "fast";
export const STATUS_KEY = "gpt-fast-mode";
export const HANDOFF_ENV = "PI_GPT_FAST_MODE";
export const SERVICE_TIER = "priority" as const;

export const COMMAND_USAGE = "Usage: /fast [on|off|toggle|status]";

export type FastAction =
	| { kind: "set"; desired: boolean }
	| { kind: "toggle" }
	| { kind: "status" };

export class FastCommandError extends Error {
	constructor(message = COMMAND_USAGE) {
		super(message);
		this.name = "FastCommandError";
	}
}

export function parseFastCommand(args: string): FastAction {
	const arg = args.trim().toLowerCase();
	if (arg === "" || arg === "toggle") return { kind: "toggle" };
	if (arg === "on") return { kind: "set", desired: true };
	if (arg === "off") return { kind: "set", desired: false };
	if (arg === "status") return { kind: "status" };
	throw new FastCommandError();
}

export function getCommandCompletions(prefix: string): { value: string; label: string }[] {
	const normalized = prefix.trim().toLowerCase();
	const labels: Record<string, string> = {
		on: "enable",
		off: "disable",
		toggle: "toggle on/off",
		status: "show current state",
	};
	return ["on", "off", "toggle", "status"]
		.filter((value) => value.startsWith(normalized))
		.map((value) => ({ value, label: `${value} — ${labels[value]}` }));
}

export interface ModelRef {
	id: string;
	name?: string;
	provider?: string;
}

export type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toModelRef(model: unknown): ModelRef | undefined {
	if (!isRecord(model) || typeof model.id !== "string" || !model.id) return undefined;
	return {
		id: model.id,
		name: typeof model.name === "string" ? model.name : undefined,
		provider: typeof model.provider === "string" ? model.provider : undefined,
	};
}

/** A model is Fast Mode eligible when its id or display name contains GPT. */
export function isGptModel(model: unknown): boolean {
	const ref = toModelRef(model);
	return ref ? /gpt/i.test(`${ref.name ?? ""} ${ref.id}`) : false;
}

export function formatModel(model: unknown): string {
	const ref = toModelRef(model);
	if (!ref) return "unknown model";
	return ref.provider ? `${ref.provider}/${ref.id}` : ref.id;
}

/** Return the original payload when it cannot be safely rewritten. */
export function injectPriorityTier(payload: unknown): unknown {
	if (!isRecord(payload)) return payload;
	return { ...payload, service_tier: SERVICE_TIER };
}

export function readHandoff(env: Record<string, string | undefined> = process.env): boolean | undefined {
	if (env[HANDOFF_ENV] === "1") return true;
	if (env[HANDOFF_ENV] === "0") return false;
	return undefined;
}

export function writeHandoff(desired: boolean, env: Record<string, string | undefined> = process.env): void {
	env[HANDOFF_ENV] = desired ? "1" : "0";
}

export class FastState {
	private desired = false;
	private model: unknown;

	setDesired(desired: boolean): void {
		this.desired = desired;
	}

	toggle(): boolean {
		this.desired = !this.desired;
		return this.desired;
	}

	setModel(model: unknown): void {
		this.model = model;
	}

	isDesired(): boolean {
		return this.desired;
	}

	isModelSupported(): boolean {
		return isGptModel(this.model);
	}

	isActive(): boolean {
		return this.desired && this.isModelSupported();
	}
}
