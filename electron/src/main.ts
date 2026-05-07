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

/**
 * Create and return the application's splash screen BrowserWindow used during startup.
 *
 * The window is configured as a small, frameless, non-resizable, always-on-top splash display.
 *
 * @returns The created BrowserWindow instance representing the splash screen.
 */
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

/**
 * Sends an IPC message to the splash window renderer on the specified channel if the splash window is available.
 *
 * @param channel - The splash IPC channel to send; either `splash:status` for progress updates or `splash:error` for error details.
 * @param payload - The value to forward to the splash renderer as the message payload.
 */
function sendSplash(channel: "splash:status" | "splash:error", payload: unknown): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send(channel, payload);
  }
}

/**
 * Register splash renderer IPC handlers; safe to call multiple times.
 *
 * Registers listeners for splash actions:
 * - `splash:show-logs`: opens the application's logs directory
 * - `splash:retry`: initiates a bootstrap retry unless a bootstrap is already in progress
 * - `splash:quit`: exits the application with code 1
 */
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

/**
 * Create the main application BrowserWindow using the previously saved window state and load the provided frontend URL.
 *
 * @param frontendUrl - The URL (typically `http://127.0.0.1:<port>` or app file URL) to load into the window
 * @returns The created BrowserWindow instance
 */
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
      // Narrow preload — no `restartSidecar`. The settings window uses the
      // wider `preload.js`.
      preload: path.join(__dirname, "main-preload.js"),
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

/**
 * Start and initialize the application's background services, display the splash UI, and create the main window.
 *
 * Ensures only one bootstrap runs at a time. Creates and registers the splash UI when needed, instantiates and registers
 * the SidecarManager, forwards sidecar progress to the splash, and enforces a startup watchdog. On successful startup,
 * creates the main application window, registers IPC and file handlers, initializes the app menu and auto-updater, drains
 * any pending files, and closes the splash. On failure, surfaces an error on the splash and attempts a best-effort
 * shutdown of background services. Always resets the bootstrap-in-progress flag when finished.
 */
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

/**
 * Attempts to stop any running sidecar manager and then restarts the bootstrap flow.
 *
 * If a sidecar manager exists, waits for its shutdown and ignores any errors from shutdown; clears the global reference and invokes `bootstrap()` to retry startup.
 */
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
