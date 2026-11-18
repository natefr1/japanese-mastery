// App updates via the Tauri updater plugin, served from GitHub Releases.
// Every update is signature-checked against the public key built into the app.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "./api";

export type UpdateCheck =
  | { kind: "none" }
  | { kind: "available"; update: Update; version: string; notes: string; date?: string }
  | { kind: "error"; message: string };

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const update = await check({ timeout: 15_000 });
    if (!update) return { kind: "none" };
    return { kind: "available", update, version: update.version, notes: update.body ?? "", date: update.date };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "error", message: friendly(msg) };
  }
}

function friendly(msg: string): string {
  if (/pubkey|public key|UPDATER_PUBLIC_KEY_NOT_SET/i.test(msg)) return "Updates aren't set up yet for this build (no signing key). See docs/UPDATES.md.";
  if (/404|not found/i.test(msg)) return "No releases have been published yet.";
  if (/network|dns|connect|timed out|timeout|offline/i.test(msg)) return "Couldn't reach GitHub. Check your connection and try again.";
  return msg;
}

/** Backs up the database, downloads and verifies the update, then restarts into it. */
export async function installUpdate(update: Update, onProgress: (pct: number | null) => void): Promise<void> {
  await api.backupCreate("pre-update");
  let total = 0;
  let got = 0;
  await update.downloadAndInstall((ev) => {
    if (ev.event === "Started") {
      total = ev.data.contentLength ?? 0;
      onProgress(total ? 0 : null);
    } else if (ev.event === "Progress") {
      got += ev.data.chunkLength;
      onProgress(total ? Math.min(1, got / total) : null);
    } else if (ev.event === "Finished") {
      onProgress(1);
    }
  });
  // On Windows the installer usually closes the app itself; relaunch covers the rest.
  await relaunch();
}
