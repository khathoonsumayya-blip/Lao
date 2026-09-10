import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectories = [
  path.join(root, "lib", "api-client-react", "src", "generated"),
  path.join(root, "lib", "api-zod", "src", "generated"),
];

async function generatedFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await generatedFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

async function snapshotGeneratedFiles() {
  const snapshot = new Map();
  for (const directory of generatedDirectories) {
    for (const file of await generatedFiles(directory)) {
      snapshot.set(path.relative(root, file), await readFile(file));
    }
  }
  return snapshot;
}

const before = await snapshotGeneratedFiles();
const generation = spawnSync("pnpm", ["run", "generate"], {
  cwd: path.join(root, "lib", "api-spec"),
  stdio: "inherit",
});

if (generation.status !== 0) {
  process.exit(generation.status ?? 1);
}

const after = await snapshotGeneratedFiles();
const changed = new Set([...before.keys(), ...after.keys()].filter((file) => {
  const previous = before.get(file);
  const current = after.get(file);
  return !previous || !current || !previous.equals(current);
}));

if (changed.size > 0) {
  console.error(
    [
      "Generated API contracts are out of date.",
      "Run `pnpm --filter @workspace/api-spec run generate`, then review and commit the generated changes.",
      "",
      "Files changed by regeneration:",
      ...[...changed].map((file) => `- ${file}`),
    ].join("\n"),
  );
  process.exit(1);
}

console.log("Generated API contracts are up to date.");