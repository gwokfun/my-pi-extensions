# my-pi-extensions

Personal [pi](https://pi.dev) package: extensions, skills, prompt templates, and themes.

## Layout

```text
extensions/   # *.ts or */index.ts
skills/       # SKILL.md folders or top-level .md
prompts/      # *.md prompt templates
themes/       # *.json themes
```

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

## Notes

- Extensions run with full local permissions. Keep this repo private if it contains sensitive automation.
- Runtime deps for extensions go in `dependencies`. Pi core packages stay in `peerDependencies`.
