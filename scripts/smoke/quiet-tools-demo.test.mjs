import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("quiet-tools demo renders the documented collapsed and expanded read aggregate", () => {
	const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/demo/quiet-tools.mjs"], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(output, `Collapsed:
▶ read 4 files

Expanded:
▼ read 4 files
  › - afile (1-300) (77 lines)
    - bfile (1-400) (177 lines)
    - cfile (1-200) (17 lines)
    - dfile (1-500) (337 lines)
`);
});
