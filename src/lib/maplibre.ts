import { getVersion, setWorkerUrl } from "maplibre-gl";

/**
 * Point MapLibre at its worker, served as a plain file from public/maplibre
 * (copied there on every npm install by scripts/copy-maplibre-worker.mjs).
 * Without this the bundler hides the worker and every map draws blank.
 * Call before creating a map; repeating it is harmless.
 */
export function setupMaplibreWorker() {
  // The version in the URL keeps a phone from using a cached worker from an
  // older MapLibre after an upgrade.
  setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${getVersion()}`);
}
