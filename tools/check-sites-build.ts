import { access, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = resolve(root, "dist");
const client = resolve(dist, "client");

async function requireFile(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing Sites build file: ${path.slice(root.length + 1)}`);
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
}

await Promise.all([
  requireFile(resolve(dist, "server", "index.js")),
  requireFile(resolve(client, "index.html")),
  requireFile(resolve(client, "_headers")),
  requireFile(resolve(client, "favicon.png")),
  requireFile(resolve(client, "og.png")),
  requireFile(resolve(dist, ".openai", "hosting.json")),
]);

const hosting = JSON.parse(
  await readFile(resolve(dist, ".openai", "hosting.json"), "utf8"),
) as Record<string, unknown>;
if (hosting.d1 !== null || hosting.r2 !== null) {
  throw new Error("Sites hosting metadata must declare null d1 and r2 bindings");
}

const packagedFiles = await listFiles(dist);
if (packagedFiles.some((path) => path.endsWith(".map"))) {
  throw new Error("Sites build must not contain production source maps");
}
const clientFiles = await listFiles(client);
const requiredAssets = [
  ["hashed JavaScript", /\/assets\/[^/]+-[A-Za-z0-9_-]+\.js$/],
  ["hashed CSS", /\/assets\/[^/]+-[A-Za-z0-9_-]+\.css$/],
  ["font", /\.(?:woff2?|ttf|otf)$/],
] as const;

for (const [label, pattern] of requiredAssets) {
  if (!clientFiles.some((path) => pattern.test(path))) {
    throw new Error(`Sites client build is missing a ${label} asset`);
  }
}

console.log("Sites build contains its Worker, metadata, HTML, JS, CSS, and fonts.");
