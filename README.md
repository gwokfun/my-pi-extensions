# my-pi-extensions

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

Add new plugins as sibling directories under `extensions/` (for example `extensions/notify/`). Keep each plugin self-contained; extract a shared `lib/` only when two or more plugins need the same code.

**Naming:** tool names, slash commands, and prompt filenames are package-global — avoid collisions with existing entries (`subagent`, `explore*`, `implement-and-review`).

## Install

```bash
# global
pi install git:github.com/gwokfun/my-pi-extensions@main

# project-local
pi install -l git:github.com/gwokfun/my-pi-extensions@main

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

## Notes

- Extensions run with full local permissions. Keep this repo private if it contains sensitive automation.
- Runtime deps for extensions go in `dependencies`. Pi core packages stay in `peerDependencies`.
- Optional package filters in settings can enable/disable individual extensions without removing the package.
