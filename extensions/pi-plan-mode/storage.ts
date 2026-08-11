import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export async function writePlanArtifact(filePath: string, content: string): Promise<void> {
	await withFileMutationQueue(filePath, async () => {
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
	});
}

export async function readPlanArtifact(filePath: string): Promise<string> {
	return readFile(filePath, "utf8");
}
