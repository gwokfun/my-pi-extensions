import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));

assert.equal(packageJson.name, "@gwokfun/my-pi-extensions");
assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.notEqual(packageJson.private, true);
assert.equal(packageJson.publishConfig?.access, "public");
assert.equal(packageJson.publishConfig?.registry, "https://registry.npmjs.org");
assert.deepEqual(packageJson.files, [
	"extensions/**/*.ts",
	"!extensions/**/*.test.ts",
	"extensions/**/*.md",
	"skills/**/*.md",
	"prompts/**/*.md",
	"themes/**/*.json",
]);
assert.equal(packageJson.pi?.extensions?.includes("./extensions"), true);

const extensionRoot = resolve(packageRoot, "extensions");
const extensionNames = (await readdir(extensionRoot, { withFileTypes: true }))
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

assert.ok(extensionNames.length > 0, "expected at least one extension");
for (const name of extensionNames) {
	await access(resolve(extensionRoot, name, "index.ts"));
}
