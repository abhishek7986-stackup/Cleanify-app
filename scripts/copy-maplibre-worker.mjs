// Copies MapLibre's map worker into public/, so the browser can load it as a
// plain file. Bundlers rename and relocate it otherwise, and the map renders
// blank (no tiles, no lines) with "Failed to load module script".
// Runs after every npm install, so the copy always matches the installed version.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "maplibre-gl", "dist");
const to = join(root, "public", "maplibre");
mkdirSync(to, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(from, f), join(to, f));
console.log("maplibre worker copied to public/maplibre");
