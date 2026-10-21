import { emptyArchive, type Archive } from "../sim/archive.ts";

/**
 * The archive in the browser: kept apart from the save, so it outlives
 * every company. A run that ends is added once and never taken back.
 */

const ARCHIVE_KEY = "rocketx.archive.v1";

export function loadArchive(): Archive {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return emptyArchive();
    const archive = JSON.parse(raw) as Archive;
    return archive.version === 1 ? { ...emptyArchive(), ...archive } : emptyArchive();
  } catch {
    return emptyArchive();
  }
}

export function saveArchive(archive: Archive): void {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
  } catch {
    // Storage can be full or blocked; the archive lives in memory until the page closes.
  }
}
