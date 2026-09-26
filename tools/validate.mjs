import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const errors = [];
function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
for (const path of walk(root).filter(p => p.endsWith(".json"))) {
  try { JSON.parse(readFileSync(path, "utf8")); } catch (error) { errors.push(`${relative(root, path)}: invalid JSON (${error.message})`); }
}
const bp = join(root, "behavior_pack"), rp = join(root, "resource_pack");
const bpManifest = JSON.parse(readFileSync(join(bp, "manifest.json"))), rpManifest = JSON.parse(readFileSync(join(rp, "manifest.json")));
if (!bpManifest.modules.some(module => module.type === "script" && module.entry === "scripts/main.js")) errors.push("Behavior manifest does not load scripts/main.js.");
if (!bpManifest.dependencies.some(dep => dep.uuid === rpManifest.header.uuid)) errors.push("Behavior manifest does not depend on this resource pack.");
if (!existsSync(join(bp, "scripts", "main.js"))) errors.push("Compiled behavior_pack/scripts/main.js is missing; run npm run build.");
const textures = JSON.parse(readFileSync(join(rp, "textures", "item_texture.json"), "utf8")).texture_data;
for (const path of walk(join(bp, "items"))) {
  const item = JSON.parse(readFileSync(path, "utf8"))["minecraft:item"];
  if (!item?.description?.identifier?.startsWith("spdim:")) errors.push(`${relative(root, path)} lacks a spdim identifier.`);
  if (!textures[item.components?.["minecraft:icon"]]) errors.push(`${relative(root, path)} references an unbound item icon.`);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("Validated manifests, JSON, item icons, and compiled script entrypoint.");
