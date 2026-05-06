import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { SidecarManager, setSidecarManager } from "./sidecars/manager";
import { loadSettingsEnv, loadSecretsEnv } from "./settings/store";
import { getLogger, logsDirectory } from "./sidecars/logger";
import { registerSettingsIpc } from "./settings/ipc";
import { buildAppMenu } from "./menu";
import { restoreWindowState, attachWindowStateListeners } from "./window-state";
import { registerFileHandlers, drainPendingFiles } from "./file-handlers";
import { initAutoUpdater } from "./auto-updater";

const log = getLogger("main");

const BOOTSTRAP_TIMEOUT_MS = 60_000;

let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let sidecarManager: SidecarManager | null = null;
let bootstrapInFlight = false;
let splashIpcRegistered = false;

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 360,
    height: 240,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: "#0b0d12",
    webPreferences: {
      preload: path.join(__dirname, "splash-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void splash.loadFile(path.join(__dirname, "..", "resources", "splash.html"));
  splash.on("closed", () => {
    if (splashWindow === splash) splashWindow = null;
  });
  return splash;
}

function sendSplash(channel: "splash:status" | "splash:error", payload: unknown): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send(channel, payload);
  }
}

function registerSplashIpc(): void {
  if (splashIpcRegistered) return;
  splashIpcRegistered = true;

  ipcMain.on("splash:show-logs", () => {
    void shell.openPath(logsDirectory());
  });

  ipcMain.on("splash:retry", () => {
    log.info("splash retry requested");
    if (bootstrapInFlight) return;
    void retryBootstrap();
  });

  ipcMain.on("splash:quit", () => {
    log.info("splash quit requested");
    app.exit(1);
  });
}

function createMainWindow(frontendUrl: string): BrowserWindow {
  const state = restoreWindowState();
  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 600,
    title: "DeepTutor",
    backgroundColor: "#0b0d12",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachWindowStateListeners(window);
  if (state.isMaximized) window.maximize();
  if (state.isFullScreen) window.setFullScreen(true);

  void window.loadURL(frontendUrl);
  window.once("ready-to-show", () => {
    window.show();
    if (process.env.NODE_ENV !== "production") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

async function bootstrap(): Promise<void> {
  if (bootstrapInFlight) return;
  bootstrapInFlight = true;

  if (!splashWindow || splashWindow.isDestroyed()) splashWindow = createSplash();
  registerSplashIpc();

  sidecarManager = new SidecarManager({
    settingsEnv: loadSettingsEnv(),
    secretsEnv: loadSecretsEnv(),
    appVersion: app.getVersion(),
  });
  setSidecarManager(sidecarManager);

  // Forward progress events to the splash so the user sees real stages.
  sidecarManager.on("progress", (stage: string) => {
    sendSplash("splash:status", stage);
  });

  // Watchdog: if start() hasn't resolved by the timeout, surface an error.
  let watchdogFired = false;
  const watchdog = setTimeout(() => {
    watchdogFired = true;
    log.error("bootstrap timed out");
    sendSplash("splash:error", {
      message: "DeepTutor is taking longer than expected to start.",
      detail:
        "Check the logs for clues. Common causes: a missing API key, a wrong host URL, or a hidden-import gap in the backend bundle.",
    });
  }, BOOTSTRAP_TIMEOUT_MS);

  try {
    const urls = await sidecarManager.start();
    clearTimeout(watchdog);
    if (watchdogFired) {
      log.warn("sidecars eventually came up after watchdog fired");
    }

    mainWindow = createMainWindow(urls.frontendUrl);

    registerSettingsIpc(sidecarManager);
    registerFileHandlers(
      () => mainWindow,
      () => sidecarManager?.getBackendUrl() ?? "",
    );
    buildAppMenu(() => mainWindow);
    initAutoUpdater();

    drainPendingFiles();

    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  } catch (err) {
    clearTimeout(watchdog);
    log.error({ err: String(err) }, "bootstrap failed");
    sendSplash("splash:error", {
      message: "DeepTutor could not start its background services.",
      detail: String(err),
    });
    // Best-effort cleanup so a Retry can re-spawn cleanly.
    try {
      await sidecarManager?.shutdown();
    } catch {
      // ignore — we're already in an error path
    }
  } finally {
    bootstrapInFlight = false;
  }
}

async function retryBootstrap(): Promise<void> {
  log.info("retrying bootstrap");
  try {
    await sidecarManager?.shutdown();
  } catch {
    // ignore
  }
  sidecarManager = null;
  await bootstrap();
}

app.whenReady().then(() => {
  void bootstrap();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && sidecarManager) {
      const port = sidecarManager.getFrontendPort();
      if (port > 0) mainWindow = createMainWindow(`http://127.0.0.1:${port}`);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!sidecarManager || sidecarManager.isShutdownInProgress()) return;
  event.preventDefault();
  void sidecarManager.shutdown().finally(() => app.exit(0));
});
