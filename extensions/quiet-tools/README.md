# Quiet Tools

Grok Build-style, one-line rendering for Pi's built-in `read`, `bash`, `edit`, `write`, `find`, `grep`, and `ls` tools. The plugin obtains each implementation from Pi's public factory and delegates execution unchanged; only the visual shell is replaced.

After installation, calls from one agent turn are folded into a time-range group such as `› ▶ 11/11 tools · 13.8s`. This provides two levels of folding: select and open one group to see its tool rows, then select and open only one row to see that tool's full output. Opening either level does not expand its siblings. Running calls use `◇`, completed calls `◆`, and failures `✗`.

When a turn contains only reads, they receive a purpose-built aggregate instead of repeated tool rows:

```text
▼ read 4 files
  › - afile (1-300) (77 lines)
    - bfile (1-400) (177 lines)
    - cfile (1-200) (17 lines)
    - dfile (1-500) (337 lines)
```

The range reflects the requested `offset`/`limit`; the final count reports the lines actually returned.

Run the deterministic simulation without starting Pi or calling a model:

```bash
npm run demo:quiet-tools
```

It prints both the first-level collapsed row and the expanded per-file list shown above. The corresponding smoke test asserts the complete output byte-for-byte, so documentation and rendering cannot silently drift apart.

| Key | Action |
| --- | --- |
| **Ctrl+O** | Open/close the current aggregate group |
| **Ctrl+J / Ctrl+K** | Select the next/previous tool inside that group |
| **Ctrl+Shift+J / Ctrl+Shift+K** | Select the next/previous aggregate group |
| **Ctrl+E** | Open/close only the selected tool's details |

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
