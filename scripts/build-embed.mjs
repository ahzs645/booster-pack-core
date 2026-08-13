#!/usr/bin/env node
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import autoprefixer from "autoprefixer";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

await import("./verify-assets.mjs");

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFlag = process.argv.indexOf("--out");
const requested = outFlag >= 0 ? process.argv[outFlag + 1] : undefined;
if (outFlag >= 0 && !requested) {
  throw new Error("--out requires a directory");
}
const output = requested
  ? isAbsolute(requested) ? requested : resolve(process.cwd(), requested)
  : resolve(packageRoot, "dist", "embed");

if (output === "/" || output === packageRoot) {
  throw new Error(`Refusing unsafe output directory: ${output}`);
}

const experience = resolve(packageRoot, "src", "experience");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await build({
  entryPoints: [resolve(experience, "standalone.tsx")],
  outfile: resolve(output, "pack-opening.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["safari17"],
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

const cssSource = await readFile(resolve(experience, "standalone.css"), "utf8");
const css = await postcss([
  tailwindcss({
    content: [resolve(experience, "**/*.{ts,tsx,html}")],
    darkMode: "media",
    theme: {
      extend: {
        colors: {
          border: "hsl(var(--border))",
          background: "hsl(var(--background))",
          foreground: "hsl(var(--foreground))",
          primary: {
            DEFAULT: "hsl(var(--primary))",
            foreground: "hsl(var(--primary-foreground))",
          },
          muted: {
            DEFAULT: "hsl(var(--muted))",
            foreground: "hsl(var(--muted-foreground))",
          },
          destructive: "hsl(var(--destructive))",
        },
      },
    },
  }),
  autoprefixer,
]).process(cssSource, { from: resolve(experience, "standalone.css") });

await writeFile(resolve(output, "styles.css"), css.css);
const javascript = await readFile(resolve(output, "pack-opening.js"));
const buildID = createHash("sha256").update(javascript).digest("hex").slice(0, 12);
const html = (await readFile(resolve(experience, "standalone.html"), "utf8"))
  .replace("__PACK_BUILD__", buildID);
await writeFile(resolve(output, "index.html"), html);
await writeFile(
  resolve(output, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>app.tcger.pack-opening</string>
  <key>CFBundleName</key><string>PackOpening</string>
  <key>CFBundlePackageType</key><string>BNDL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
</dict></plist>
`,
);
await cp(resolve(packageRoot, "assets", "pack"), resolve(output, "pack"), {
  recursive: true,
});

console.log(`pack opening embed → ${output}`);
