import { existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const build = join(root, "build");
mkdirSync(build, { recursive: true });
const output = join(build, "spdim-bedrock.mcaddon");
if (existsSync(output)) rmSync(output);
// `jar` writes standards-compliant ZIP archives and is available with the Java
// tooling commonly installed for Bedrock/Android development environments.
const result = spawnSync("jar", ["--create", "--file", output, "-C", root, "behavior_pack", "resource_pack"], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Created ${output}`);
