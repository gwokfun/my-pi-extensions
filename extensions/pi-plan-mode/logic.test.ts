import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
	cloneSnapshotForSession,
	emptySnapshot,
	getPlanCommandCompletions,
	getToolsForPhase,
	hashPlanContent,
	isPlanModeSnapshot,
	isToolAllowed,
	isTrustedPlanTool,
	latestSnapshotFromEntries,
	MAX_PLAN_BYTES,
	normalizePlanContent,
	parsePlanCommand,
	PLAN_ENTRY_TYPE,
	planToolIntegrityIssues,
	planSummary,
	restoreTools,
	sessionPlanPath,
	startPlanningSnapshot,
	validatePlanContent,
} from "./logic.ts";

const allTools = ["read", "bash", "edit", "write", "grep", "find", "ls", "write_plan", "submit_plan", "subagent"];

test("parses plan commands and completions", () => {
	assert.deepEqual(parsePlanCommand(""), { kind: "enter" });
	assert.deepEqual(parsePlanCommand("status"), { kind: "status" });
	assert.deepEqual(parsePlanCommand(" REVIEW "), { kind: "review" });
	assert.deepEqual(parsePlanCommand("off"), { kind: "off" });
	assert.deepEqual(parsePlanCommand("plan the cache migration"), {
		kind: "enter",
		task: "plan the cache migration",
	});
	assert.deepEqual(getPlanCommandCompletions("re"), [{ value: "review", label: "review — reopen pending approval" }]);
	assert.equal(getPlanCommandCompletions("review now"), null);
});

test("normalizes, validates, hashes, and summarizes plan Markdown", () => {
	assert.equal(normalizePlanContent("# Plan\r\nBody"), "# Plan\nBody\n");
	assert.equal(validatePlanContent("# Plan"), "# Plan\n");
	assert.throws(() => validatePlanContent("  \n"), /Plan is empty/);
	assert.throws(() => validatePlanContent("x".repeat(MAX_PLAN_BYTES + 1)), /Plan is too large/);
	assert.equal(hashPlanContent("same"), hashPlanContent("same"));
	assert.notEqual(hashPlanContent("same"), hashPlanContent("different"));
	assert.equal(planSummary("\n## Cache migration\nDetails"), "Cache migration");
});

test("uses a strict tool allowlist while planning and while approval is pending", () => {
	assert.deepEqual(getToolsForPhase("planning", allTools), [
		"read",
		"grep",
		"find",
		"ls",
		"write_plan",
		"submit_plan",
	]);
	assert.deepEqual(getToolsForPhase("awaiting_approval", allTools), ["read", "grep", "find", "ls"]);
	assert.equal(isToolAllowed("planning", "write_plan"), true);
	assert.equal(isToolAllowed("planning", "bash"), false);
	assert.equal(isToolAllowed("planning", "subagent"), false);
	assert.equal(isToolAllowed("awaiting_approval", "submit_plan"), false);
	assert.equal(isToolAllowed("inactive", "unknown-tool"), true);
});

test("trusts built-ins and this extension's tools but rejects protected-name shadowing", () => {
	const extensionDir = path.resolve("C:/plugins/pi-plan-mode");
	const builtInRead = {
		name: "read",
		sourceInfo: { path: "<builtin:read>", source: "builtin" },
	};
	const ownWritePlan = {
		name: "write_plan",
		sourceInfo: { path: path.join(extensionDir, "index.ts"), source: "local", baseDir: extensionDir },
	};
	const ownSubmitPlan = {
		name: "submit_plan",
		sourceInfo: { path: path.join(extensionDir, "index.ts"), source: "local", baseDir: extensionDir },
	};
	const shadowedRead = {
		name: "read",
		sourceInfo: { path: "C:/plugins/malicious/index.ts", source: "local", baseDir: "C:/plugins/malicious" },
	};
	assert.equal(isTrustedPlanTool(builtInRead, extensionDir), true);
	assert.equal(isTrustedPlanTool(ownWritePlan, extensionDir), true);
	assert.equal(isTrustedPlanTool(shadowedRead, extensionDir), false);
	assert.deepEqual(planToolIntegrityIssues([builtInRead, ownWritePlan, ownSubmitPlan], extensionDir), []);
	assert.deepEqual(planToolIntegrityIssues([shadowedRead, ownWritePlan, ownSubmitPlan], extensionDir), [
		"read is provided by C:/plugins/malicious/index.ts",
	]);
});

test("restores the original tool set without discarding unrelated current tools", () => {
	assert.deepEqual(
		restoreTools(
			["read", "grep", "write_plan", "third-party"],
			["read", "bash", "edit"],
			["grep", "write_plan", "submit_plan"],
			[...allTools, "third-party"],
		),
		["read", "third-party", "bash", "edit"],
	);
});

test("creates branch-local snapshots and gives a fork a fresh plan identity", () => {
	const planning = startPlanningSnapshot({
		sessionId: "parent-session",
		planId: "parent-plan",
		originalActiveTools: ["read", "bash", "edit"],
		allToolNames: allTools,
		content: "# Parent plan\n",
		updatedAt: "2026-08-11T00:00:00.000Z",
	});
	assert.equal(planning.revision, 1);
	assert.equal(planning.contentHash, hashPlanContent(planning.content));
	assert.deepEqual(planning.planAddedTools, ["grep", "find", "ls", "write_plan", "submit_plan"]);

	const fork = cloneSnapshotForSession({
		snapshot: planning,
		sessionId: "fork-session",
		planId: "fork-plan",
		originalActiveTools: ["read", "bash", "edit"],
		allToolNames: allTools,
		updatedAt: "2026-08-11T00:01:00.000Z",
	});
	assert.equal(fork.sessionId, "fork-session");
	assert.equal(fork.planId, "fork-plan");
	assert.equal(fork.phase, "planning");
	assert.equal(fork.content, planning.content);
	assert.equal(fork.revision, 1);
});

test("reconstructs only a valid latest snapshot from the active branch", () => {
	const first = emptySnapshot("session-1", "2026-08-11T00:00:00.000Z");
	const latest = startPlanningSnapshot({
		sessionId: "session-1",
		planId: "plan-1",
		originalActiveTools: ["read"],
		allToolNames: allTools,
		updatedAt: "2026-08-11T00:01:00.000Z",
	});
	const entries = [
		{ type: "custom", customType: PLAN_ENTRY_TYPE, data: first },
		{ type: "custom", customType: "other", data: latest },
		{ type: "custom", customType: PLAN_ENTRY_TYPE, data: { ...latest, originalActiveTools: [42] } },
		{ type: "custom", customType: PLAN_ENTRY_TYPE, data: latest },
	];
	assert.equal(isPlanModeSnapshot(entries[2].data), false);
	assert.deepEqual(latestSnapshotFromEntries(entries), latest);
});

test("keeps plan.md inside the session plan directory", () => {
	const sessionDir = path.resolve("C:/tmp/pi-sessions");
	assert.equal(
		sessionPlanPath(sessionDir, "session/id"),
		path.join(sessionDir, "pi-plan-mode", "session_id", "plan.md"),
	);
	assert.equal(sessionPlanPath(sessionDir, ".."), path.join(sessionDir, "pi-plan-mode", "session", "plan.md"));
});
