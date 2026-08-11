# GPT Fast Mode

This extension requests OpenAI-style `service_tier: "priority"` for models
whose model ID or display name contains `GPT` (case-insensitive).

## Usage

```text
/fast             # toggle
/fast on          # enable
/fast off         # disable
/fast status      # show current state
pi --fast         # start with Fast Mode requested
```

Fast Mode is off by default and is process-scoped. Switching to a non-GPT model
stops request mutation while preserving the desired preference; switching back
to a GPT model resumes it.

When enabled, the status bar shows `fast`. If the current model is not GPT but
the preference is armed for a subagent, it shows `fast⇢`.

## Subagents

The preference is handed off through `PI_GPT_FAST_MODE=1/0`. The child Pi must
load this package; install the package with `pi install` when subagent behavior
is required. A child model still needs `GPT` in its ID or name before its own
request is modified.

This extension does not guarantee lower latency or account eligibility. The
selected provider must accept the `service_tier` field.

Do not load this extension together with another extension that registers
`/fast` or `--fast`, including the upstream `pi-gpt-fast-mode` package.
