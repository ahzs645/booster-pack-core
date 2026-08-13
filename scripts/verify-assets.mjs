#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packRoot = resolve(packageRoot, "assets", "pack");
const manifestPath = resolve(packRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const publishedRegistries = ["covers", "bases", "decals"];
const errors = [];

for (const name of publishedRegistries) {
  const entries = manifest[name];
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    errors.push(`manifest.${name} must be an empty object`);
  } else if (Object.keys(entries).length > 0) {
    errors.push(
      `manifest.${name} contains published assets; publish them to R2 instead`,
    );
  }
}

const rasterExtensions = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

async function findRasterAssets(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await findRasterAssets(path);
    else if (entry.isFile() && rasterExtensions.has(extname(entry.name).toLowerCase())) {
      errors.push(
        `${relative(packageRoot, path)} is published artwork; upload it to R2 instead`,
      );
    }
  }
}

for (const name of publishedRegistries) {
  await findRasterAssets(resolve(packRoot, name));
}

if (errors.length > 0) {
  throw new Error(errors.map((error) => `- ${error}`).join("\n"));
} else {
  console.log("ok   pack artwork is R2-only; bundled registries are empty");
}
