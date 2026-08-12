# Quiet Tools

Grok Build-style, one-line rendering for Pi's built-in `read`, `bash`, `edit`, `write`, `find`, `grep`, and `ls` tools. The plugin obtains each implementation from Pi's public factory and delegates execution unchanged; only the visual shell is replaced.

After installation, calls appear as a quiet activity stream instead of separate red/green cards. Running calls use `◇`, completed calls `◆`, and failures `✗`; the pending row is replaced by its completed row rather than duplicated. Errors show their details automatically. Press **Ctrl+E** to toggle expanded tool output globally.

The plugin does not edit `~/.pi/agent/settings.json`. It only sets the hidden-thinking label when a session starts. To fold reasoning, explicitly set `hideThinkingBlock: true` in your Pi startup settings; RPC/headless use remains safe.

## Extension tools

There is deliberately no attempt to replace unknown tools such as `web_search`. Their owner can opt in while registering the real executable definition:

```ts
import { withCollapsedRendering } from "../quiet-tools/index.ts";

pi.registerTool(withCollapsedRendering(webSearchTool, {
  match: "web_search",
  summarizeCall: (args) => `search ${args.query}`,
  summarizeResult: (result, partial) => partial ? "searching" : `${result.details.hits} hits`,
  expandedContent: (_args, result) => result.content[0].text,
  isSuccess: (result) => !result.details.error,
}));
```

Adapters contain all tool-specific knowledge. The shared renderer only chooses state icons, produces a single collapsed line, truncates to terminal width, and displays expanded content. Tools without an adapter use cycle-safe JSON/text fallback rendering.
