# @gwokfun/my-pi-extensions

Personal [pi](https://pi.dev) package: extensions, skills, prompt templates, and themes.

## Layout

```text
extensions/   # one subdirectory per plugin (*/index.ts) or top-level *.ts
skills/       # SKILL.md folders or top-level .md
prompts/      # *.md prompt templates (shared flat namespace)
themes/       # *.json themes
```

## Plugin catalog

| Plugin | Path | What it does |
|--------|------|----------------|
| **subagent** | `extensions/subagent/` | Spawn specialized subagents (explorer / planner / worker / reviewer / default) with model + thinking config; `/subagent-view` or Ctrl+Shift+S opens a live fullscreen overlay |
| **gpt-fast-mode** | `extensions/gpt-fast-mode/` | Requests `service_tier: priority` for GPT-named models via `/fast`, `--fast`, and subagent environment hand-off |
| **openai-remote-compaction** | `extensions/openai-remote-compaction/` | Uses Responses `/compact` for GPT models and falls back to Pi native compaction on every unsupported or failed request |
| **pi-plan-mode** | `extensions/pi-plan-mode/` | Adds a read-only planning lifecycle with session-local `plan.md`, a large Markdown approval overlay, revision feedback, and explicit approval/abandon gates |
| **grok-tui** | `extensions/grok-tui/` | Opens a full-screen Grok-style structured transcript with selectable thinking/tool blocks, single/global folding, streaming updates, and prompt input |

Add new plugins as sibling directories under `extensions/` (for example `extensions/notify/`). Keep each plugin self-contained; extract a shared `lib/` only when two or more plugins need the same code.

**Naming:** tool names, slash commands, and prompt filenames are package-global — avoid collisions with existing entries (`subagent`, `explore*`, `implement-and-review`).

## Install

```bash
# npm, global
pi install npm:@gwokfun/my-pi-extensions

# npm, project-local
pi install -l npm:@gwokfun/my-pi-extensions

# git source
pi install git:github.com/gwokfun/my-pi-extensions@main

# local path (this checkout)
pi install ./my-pi-extensions
pi install -l ./my-pi-extensions
```

## Develop

1. Add or edit files under `extensions/`, `skills/`, `prompts/`, or `themes/`.
2. In a pi session, run `/reload` (path installs and auto-discovered packages pick up changes after reload).
3. Commit and push; on other machines run `pi update --extensions` or reinstall with a new ref.

### Subagent quick start

After install/reload, the main agent can call the `subagent` tool, or you can use:

- `/explore <question>`
- `/explore-and-plan <feature>`
- `/explore-and-implement <feature>`
- `/implement-and-review <change>`
- `/subagent-view` or **Ctrl+Shift+S** — fullscreen live viewer while a subagent runs (Esc/q closes; does not stop children)

See [extensions/subagent/README.md](extensions/subagent/README.md) for agent tables, model/thinking configuration, and discovery rules.

### Plan Mode quick start

```text
/plan plan the requested change
```

The agent can inspect the repository and update the session-local `plan.md`, but project writes, shell commands, subagents, and unknown tools remain blocked. When planning is complete, the plugin opens a large Markdown review overlay:

- `a` — approve and restore normal tools after the current run settles
- `r` — enter revision feedback and return the agent to planning
- `q` — confirm abandonment while preserving the plan artifact
- `Esc` — close the overlay with approval still pending

Use `/plan review` to reopen a pending decision, `/view-plan` for a read-only preview, `/plan status` for the lifecycle state and artifact path, or `/plan off` to abandon from an idle TUI. Approval never starts implementation automatically.

See [extensions/pi-plan-mode/README.md](extensions/pi-plan-mode/README.md) for lifecycle, persistence, and safety details.

### Grok TUI quick start

Run `/grok-tui` to open the structured transcript view. The view mirrors the current session and continues receiving message/tool events while it is open. Use `Esc` to return to the native Pi screen.

- `↑/↓` — select a content block when the prompt is empty
- `←/→` — collapse/expand the selected thinking or tool block
- `Enter` — toggle the selected block, or submit a prompt when text is entered
- `Ctrl+O` — toggle all tool blocks; `Ctrl+T` — toggle all thinking blocks
- `PgUp/PgDn`, `Home/End` — scroll; `End` resumes following output

### Test

```bash
npm test         # all deterministic extension tests
npm run smoke    # all package/plugin smoke tests; no API key or network
npm run verify:stock-pi  # load every extension entrypoint through the installed stock Pi loader
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the test and smoke-test contract for new plugins.

## Notes

- Extensions run with full local permissions. Review the source before installing; this repository and its npm package are public.
- Runtime deps for extensions go in `dependencies`. Pi core packages stay in `peerDependencies`.
- Extensions use documented Pi package roots only; no Pi main-program Loader patch is required.
- Optional package filters in settings can enable/disable individual extensions without removing the package.
