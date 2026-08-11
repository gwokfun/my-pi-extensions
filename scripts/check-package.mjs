import { spawnSync } from "node:child_process";

const npmArgs = ["pack", "--dry-run", "--json"];
const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const commandArgs = process.env.npm_execpath ? [process.env.npm_execpath, ...npmArgs] : npmArgs;
const result = spawnSync(npmCommand, commandArgs, {
	encoding: "utf8",
});

if (result.error) throw result.error;
if (result.status !== 0) {
	process.stderr.write(result.stderr || result.stdout || "npm pack failed without output\n");
	process.exit(result.status ?? 1);
}

const [report] = JSON.parse(result.stdout);
const allowedFiles = new Set(["package.json", "README.md"]);
const allowedRoots = ["extensions/", "skills/", "prompts/", "themes/"];
const forbiddenFiles = report.files
	.map(({ path }) => path)
	.filter(
		(path) =>
			(!allowedFiles.has(path) && !allowedRoots.some((root) => path.startsWith(root))) ||
			/\.test\.[cm]?[jt]s$/.test(path) ||
			path.startsWith("scripts/"),
	);

if (forbiddenFiles.length > 0) {
	console.error(`Unexpected files in npm package:\n${forbiddenFiles.join("\n")}`);
	process.exit(1);
}

console.log(`Verified ${report.files.length} publishable files for ${report.id}.`);
