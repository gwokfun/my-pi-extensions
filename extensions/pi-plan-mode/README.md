# pi-plan-mode

`pi-plan-mode` adds an explicit planning and approval gate to Pi. It is intentionally conservative: the agent can inspect the repository and maintain one complete Markdown plan, but it cannot edit project files, execute shell commands, delegate to subagents, or invoke unknown tools until the user approves or abandons the plan.

Approval restores the previous tool set only after the active agent run emits `agent_settled`. It does not start implementation; the plugin waits for the user's next instruction.

## Start and control Plan Mode

| Command or key | Behavior |
|----------------|----------|
| `/plan` | Enter Plan Mode without sending a task |
| `/plan <task>` | Enter Plan Mode and send the task to the agent |
| `Ctrl+Alt+P` | Enter Plan Mode without sending a task |
| `/plan status` | Show the current phase, revision, and plan path |
| `/plan review` | Reopen a plan whose approval overlay was dismissed |
| `/view-plan` | Preview the current branch plan without approval actions |
| `/plan off` | Abandon Plan Mode while the agent is idle |

Plan Mode requires Pi's interactive TUI. Non-interactive attempts fail closed because approval must be an explicit local UI action.

## Agent tools

While the phase is `planning`, the active tool set is reduced to available tools from this allowlist:

```text
read, grep, find, ls, write_plan, submit_plan
```

`write_plan` replaces the complete plan; it does not append a fragment. Content is normalized to LF line endings, must be non-empty, and is limited to 256 KiB. `submit_plan` validates the artifact and opens the blocking review overlay. It should be the only and final tool call in that assistant message.

During `awaiting_approval` and the two settling phases, only the read-only subset remains available. A `tool_call` guard blocks every other registered tool, and a separate `user_bash` guard rejects direct `!command` input.

The allowlist is also source-checked. `read`, `grep`, `find`, and `ls` must be Pi built-ins, while `write_plan` and `submit_plan` must come from this extension directory. If another extension shadows a protected name, entry is refused; if a collision appears while active, the plugin disables every model tool until the collision is removed or Plan Mode is abandoned.

## Approval overlay

The near-fullscreen overlay renders the complete plan as Markdown and supports arrow keys, `j`/`k`, Page Up/Down, Home, and End.

| Key | Decision |
|-----|----------|
| `a` | Approve. The run is terminated, then normal tools are restored at `agent_settled`. |
| `r` | Open a feedback editor and return the agent to `planning`. |
| `q` | Confirm abandonment and preserve the plan file. |
| `Esc` or `Ctrl+C` | Dismiss the overlay without deciding; the plan remains locked in `awaiting_approval`. |

If `plan.md` is edited outside Pi before submission or before `/plan review`, the plugin validates and imports that content as a new revision before rendering it.

## Persistence and branches

The canonical state is stored as Pi custom session entries, so tree navigation reconstructs the state from the active branch. The human-readable projection is:

```text
<sessionDir>/pi-plan-mode/<sessionId>/plan.md
```

Forking an active plan copies its current Markdown into a new session-local plan with a fresh plan identity. Switching to a branch without Plan Mode state restores the previous normal tools and materializes an empty branch projection. An interrupted `approved_settling` or `abandoned_settling` state is finalized safely on the next session restore.

Each transition records the phase, plan identity, revision, SHA-256 content hash, previous active tools, tools temporarily added by Plan Mode, decision, and timestamp. Tool restoration removes only Plan Mode additions and restores the captured originals; unrelated tools still active at restoration time are retained.

## Plan structure

The planning prompt requires one decision-complete document with these sections:

```markdown
# Summary

# Implementation Changes

# Public APIs or Interfaces

# Test Plan

# Assumptions
```

The agent should resolve repository facts before asking questions. Revision feedback always results in a full replacement plan followed by another explicit submission.

## Verification

```bash
npm test
npm run smoke
```

Unit tests cover command parsing, content validation, strict tool policy, delta-aware tool restoration, branch snapshots, malformed-state rejection, and safe artifact paths. The offline smoke test loads the built Pi peers, registers the plugin, enters and exits Plan Mode with a mock session, writes a real temporary `plan.md`, and verifies the blocking hook and tool restoration behavior.
