import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getLogger } from "./sidecars/logger";

const log = getLogger("main");

const pendingFiles: string[] = [];
let backendUrlGetter: () => string = () => "";
let mainWindowGetter: () => BrowserWindow | null = () => null;

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  log.info({ filePath }, "open-file event");
  pendingFiles.push(filePath);
  if (backendUrlGetter() && mainWindowGetter()) {
    void drainPendingFiles();
  }
});

export function registerFileHandlers(
  getMainWindow: () => BrowserWindow | null,
  getBackendUrl: () => string,
): void {
  mainWindowGetter = getMainWindow;
  backendUrlGetter = getBackendUrl;

  ipcMain.handle("files:upload", async (_event, paths: string[]) => {
    if (!Array.isArray(paths)) throw new Error("files:upload expects string[]");
    const results = [];
    for (const p of paths) {
      try {
        const r = await uploadOne(p);
        results.push({ path: p, ok: true, response: r });
      } catch (err) {
        log.error({ path: p, err: String(err) }, "upload failed");
        results.push({ path: p, ok: false, error: String(err) });
      }
    }
    return results;
  });
}

export async function promptForFiles(window: BrowserWindow | null): Promise<void> {
  const opts: Electron.OpenDialogOptions = {
    title: "Open PDF",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  };
  const result = window
    ? await dialog.showOpenDialog(window, opts)
    : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return;
  for (const p of result.filePaths) pendingFiles.push(p);
  await drainPendingFiles();
}

export async function drainPendingFiles(): Promise<void> {
  while (pendingFiles.length > 0) {
    const next = pendingFiles.shift();
    if (!next) break;
    try {
      await uploadOne(next);
    } catch (err) {
      log.error({ path: next, err: String(err) }, "upload failed during drain");
    }
  }
}

async function uploadOne(filePath: string): Promise<unknown> {
  const backend = backendUrlGetter();
  if (!backend) throw new Error("backend not ready");
  const buffer = await fs.promises.readFile(filePath);
  const blob = new Blob([buffer], { type: "application/pdf" });
  const form = new FormData();
  form.append("file", blob, path.basename(filePath));
  const res = await fetch(`${backend}/api/v1/book/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`upload returned HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}
