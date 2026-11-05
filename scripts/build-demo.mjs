import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const demo = path.join(root, "演示库");
const pluginDir = path.join(demo, ".obsidian", "plugins", "omnibooks");

await mkdir(pluginDir, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(path.join(root, file), path.join(pluginDir, file));
}

await cp(path.join(root, "示例笔记"), path.join(demo, "示例笔记"), {
  recursive: true,
  force: true,
});

const communityPlugins = path.join(demo, ".obsidian", "community-plugins.json");
if (!existsSync(communityPlugins)) {
  await writeFile(communityPlugins, JSON.stringify(["omnibooks"], null, 2));
}

const appJson = path.join(demo, ".obsidian", "app.json");
if (!existsSync(appJson)) {
  await writeFile(appJson, JSON.stringify({ safeMode: false }, null, 2));
}

console.log(`演示库已更新：${demo}`);
