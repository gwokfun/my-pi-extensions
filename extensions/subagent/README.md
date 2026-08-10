# Subagent Extension

Delegate tasks to specialized subagents with isolated context windows. Part of `my-pi-extensions`.

## Features

- **Isolated context**: each subagent runs in a separate `pi` process
- **Bundled agents**: ship with the extension (no manual symlink required)
- **Model + thinking config**: per-agent frontmatter defaults and per-call overrides
- **Streaming output**: tool calls and progress as they happen
- **Parallel / chain modes**: concurrent tasks or sequential `{previous}` handoff
- **Usage tracking**: turns, tokens, cost, model, thinking level

## Structure

```text
extensions/subagent/
├── index.ts           # tool entry
├── agents.ts          # discovery + frontmatter parsing
├── agents/            # package-bundled agent definitions
│   ├── default.md
│   ├── explorer.md
│   ├── planner.md
│   ├── reviewer.md
│   └── worker.md
└── README.md
```

Package-level workflow prompts live in `../../prompts/`.

## Agents

| Agent | Purpose | Model | Thinking | Tools |
|-------|---------|-------|----------|-------|
| `default` | General multi-step delegated work | `gpt-5.6-terra` | high | all |
| `explorer` | Read-heavy investigation | `gpt-5.6-terra` | medium | read, grep, find, ls, bash |
| `planner` | Implementation plans only | `gpt-5.6-terra` | high | read, grep, find, ls |
| `reviewer` | Independent review | `gpt-5.6-terra` | high | read, grep, find, ls, bash |
| `worker` | Bounded implementation | `gpt-5.6-sol` | medium | all |

Edit `agents/*.md` to change defaults. Codex-style `reasoning_effort` is accepted as an alias for `thinking`.

## Model & thinking

### Frontmatter (defaults)

```markdown
---
name: explorer
description: ...
tools: read, grep, find, ls, bash
model: gpt-5.6-terra
thinking: medium
---
```

Valid `thinking` values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

### Per-call overrides

```json
{ "agent": "explorer", "task": "...", "model": "provider/id", "thinking": "high" }
```

Same optional fields on each item in `tasks[]` and `chain[]`.

**Resolution:** call override → agent frontmatter → omit flags (pi defaults).

## Discovery

| Source | Location | Precedence |
|--------|----------|------------|
| package | `extensions/subagent/agents/*.md` | lowest |
| user | `~/.pi/agent/agents/*.md` | middle |
| project | `.pi/agents/*.md` | highest |

- Default `agentScope: "user"` still loads **package** agents so install-and-go works.
- User agents override package agents with the same name.
- Project agents require `agentScope: "project"` or `"both"` (interactive confirm by default).

## Usage

### Single

```
Use explorer to find how auth tokens are validated
```

### With overrides

```
Use worker with thinking high to implement the caching plan in src/cache.ts only
```

### Parallel

```
Run 2 explorers in parallel: one for models, one for providers
```

### Chain

```
Chain explorer → planner → worker for adding Redis caching
```

### Workflow prompts

| Prompt | Flow |
|--------|------|
| `/explore` | explorer |
| `/explore-and-plan` | explorer → planner |
| `/explore-and-implement` | explorer → planner → worker |
| `/implement-and-review` | worker → reviewer → worker |

## Security

Project-local agents are repo-controlled prompts. Only enable `agentScope: "both"` / `"project"` for trusted repositories.

## Multi-plugin note

This extension is self-contained under `extensions/subagent/`. Other plugins in `my-pi-extensions` should use their own subdirectories and avoid registering another tool named `subagent`.
