/**
 * Agent discovery and configuration
 *
 * Sources (precedence: project > user > package):
 *   - package: bundled with this extension (extensions/subagent/agents)
 *   - user:    ~/.pi/agent/agents
 *   - project: nearest .pi/agents
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "package" | "user" | "project";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	thinking?: ThinkingLevel;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	packageAgentsDir: string | null;
}

export function isValidThinkingLevel(level: string): level is ThinkingLevel {
	return VALID_THINKING_LEVELS.has(level as ThinkingLevel);
}

function parseTools(value: unknown): string[] | undefined {
	if (typeof value === "string") {
		const tools = value
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		return tools.length > 0 ? tools : undefined;
	}
	if (Array.isArray(value)) {
		const tools = value.map((t) => String(t).trim()).filter(Boolean);
		return tools.length > 0 ? tools : undefined;
	}
	return undefined;
}

function parseThinking(frontmatter: Record<string, unknown>): ThinkingLevel | undefined {
	const raw = frontmatter.thinking ?? frontmatter.reasoning_effort;
	if (typeof raw !== "string") return undefined;
	const level = raw.trim().toLowerCase();
	return isValidThinkingLevel(level) ? level : undefined;
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);

		const name = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
		const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;
		if (!name || !description) {
			continue;
		}

		const tools = parseTools(frontmatter.tools);
		const model = typeof frontmatter.model === "string" && frontmatter.model.trim() ? frontmatter.model.trim() : undefined;
		const thinking = parseThinking(frontmatter);

		agents.push({
			name,
			description,
			tools,
			model,
			thinking,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/**
 * Discover agents for the given scope.
 * Package agents are always included as the lowest-precedence baseline.
 */
export function discoverAgents(
	cwd: string,
	scope: AgentScope,
	packageAgentsDir?: string | null,
): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	const pkgDir = packageAgentsDir && isDirectory(packageAgentsDir) ? packageAgentsDir : null;

	const packageAgents = pkgDir ? loadAgentsFromDir(pkgDir, "package") : [];
	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	// Lowest → highest precedence
	for (const agent of packageAgents) agentMap.set(agent.name, agent);

	if (scope === "user" || scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	}
	if (scope === "project" || scope === "both") {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return {
		agents: Array.from(agentMap.values()),
		projectAgentsDir,
		packageAgentsDir: pkgDir,
	};
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
