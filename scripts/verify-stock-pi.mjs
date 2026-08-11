import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(packageRoot, "extensions");
const extensionPaths = (await readdir(extensionRoot, { withFileTypes: true }))
	.filter((entry) => entry.isDirectory())
	.map((entry) => resolve(extensionRoot, entry.name, "index.ts"))
	.sort();

const args = [
	"--no-extensions",
	"--no-skills",
	"--no-prompt-templates",
	"--no-themes",
	"--no-context-files",
	"--no-approve",
	...extensionPaths.flatMap((path) => ["--extension", path]),
	"--list-models",
];
let command = { executable: process.env.PI_BIN || "pi", args };
if (process.platform === "win32") {
	let cliPath = process.env.PI_CLI_PATH;
	if (!cliPath) {
		const lookup = spawnSync("where.exe", ["pi.cmd"], { encoding: "utf8" });
		if (lookup.status !== 0) throw new Error("Unable to locate pi.cmd on PATH");
		const shimPath = lookup.stdout.split(/\r?\n/).find(Boolean);
		if (!shimPath) throw new Error("Unable to resolve the Pi CLI shim");
		cliPath = resolve(dirname(shimPath), "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
	}
	command = { executable: process.execPath, args: [cliPath, ...args] };
}
const result = spawnSync(command.executable, command.args, {
	cwd: packageRoot,
	stdio: "inherit",
	timeout: 60_000,
});

if (result.error) throw result.error;
if (result.signal) throw new Error(`Pi verification terminated by ${result.signal}`);
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Stock Pi loader accepted ${extensionPaths.length} extension entrypoints.`);
