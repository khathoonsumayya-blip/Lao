import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoots = [
  path.join(root, "lib", "api-client-react", "src", "generated"),
  path.join(root, "lib", "api-zod", "src", "generated"),
];

async function normalizeDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeDirectory(entryPath);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const source = await readFile(entryPath, "utf8");
    const normalized = `${source.trimEnd()}\n`;
    if (normalized !== source) await writeFile(entryPath, normalized);
  }
}

for (const generatedRoot of generatedRoots) {
  await normalizeDirectory(generatedRoot);
}