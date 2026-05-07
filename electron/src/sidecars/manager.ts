import { app, dialog } from "electron";
import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { getLogger } from "./logger";
import {
  spawnPythonSidecar,
  waitForPythonReady,
  type PythonSpawnResult,
} from "./python";
import {
  spawnNodeSidecar,
  waitForNodeReady,
  type NodeSpawnResult,
} from "./node";

const log = getLogger("main");

const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;
const SHUTDOWN_GRACE_MS = 5_000;

export interface SidecarUrls {
  readonly backendUrl: string;
  readonly frontendUrl: string;
}

interface SidecarState {
  child: ChildProcess | null;
  port: number;
  restartTimestamps: number[];
}

export interface ManagerOptions {
  readonly settingsEnv: Readonly<Record<string, string>>;
  readonly secretsEnv: Readonly<Record<string, string>>;
  readonly appVersion: string;
}

export class SidecarManager extends EventEmitter {
  private python: SidecarState = { child: null, port: 0, restartTimestamps: [] };
  private node: SidecarState = { child: null, port: 0, restartTimestamps: [] };
  private isShuttingDown = false;
  private dataDir = "";

  constructor(private options: ManagerOptions) {
    super();
  }

  async start(): Promise<SidecarUrls> {
    log.info("sidecar manager starting");
    this.isShuttingDown = false;

    this.emit("progress", "Starting backend");
    const py = await this.startPython();
    this.python.child = py.child;
    this.python.port = py.port;
    this.dataDir = py.dataDir;
    this.attachExitHandler("python", this.python, () => this.restartPython());

    await waitForPythonReady(py.port);
    this.emit("progress", "Backend ready");

    this.emit("progress", "Starting frontend");
    const node = await this.startNode(py.port);
    this.node.child = node.child;
    this.node.port = node.port;
    this.attachExitHandler("node", this.node, () => this.restartNode());

    await waitForNodeReady(node.port);
    this.emit("progress", "Loading interface");

    const urls: SidecarUrls = {
      backendUrl: `http://127.0.0.1:${py.port}`,
      frontendUrl: `http://127.0.0.1:${node.port}`,
    };
    log.info(urls, "sidecars ready");
    this.emit("ready", urls);
    return urls;
  }

  private async startPython(): Promise<PythonSpawnResult> {
    const env: Record<string, string> = {
      ...this.options.settingsEnv,
      ...this.options.secretsEnv,
    };
    return spawnPythonSidecar(env);
  }

  private async startNode(backendPort: number): Promise<NodeSpawnResult> {
    return spawnNodeSidecar(backendPort, this.options.appVersion);
  }

  private async restartPython(): Promise<{ child: ChildProcess; port: number }> {
    const result = await this.startPython();
    this.python.child = result.child;
    this.python.port = result.port;
    this.dataDir = result.dataDir;
    this.attachExitHandler("python", this.python, () => this.restartPython());
    await waitForPythonReady(result.port);
    return { child: result.child, port: result.port };
  }

  private async restartNode(): Promise<{ child: ChildProcess; port: number }> {
    const result = await this.startNode(this.python.port);
    this.node.child = result.child;
    this.node.port = result.port;
    this.attachExitHandler("node", this.node, () => this.restartNode());
    await waitForNodeReady(result.port);
    return { child: result.child, port: result.port };
  }

  private attachExitHandler(
    label: "python" | "node",
    state: SidecarState,
    restart: () => Promise<{ child: ChildProcess; port: number }>,
  ): void {
    const child = state.child;
    if (!child) return;

    child.on("exit", (code, signal) => {
      log.warn({ label, code, signal }, "sidecar exited");
      if (this.isShuttingDown) return;
      // Stale exit handler — a successful restart already replaced state.child
      // and re-attached a new handler. Ignore the old child's late exit event.
      if (state.child !== child) return;

      const now = Date.now();
      state.restartTimestamps = state.restartTimestamps.filter(
        (t) => now - t < RESTART_WINDOW_MS,
      );
      state.restartTimestamps.push(now);

      if (state.restartTimestamps.length > MAX_RESTARTS) {
        log.error({ label, count: state.restartTimestamps.length }, "max restarts exceeded");
        this.emit("crashed", { label });
        this.surfaceCrashDialog(label);
        return;
      }

      const attempt = state.restartTimestamps.length;
      const backoffMs = attempt * attempt * 1000;
      log.info({ label, attempt, backoffMs }, "restarting sidecar after backoff");
      setTimeout(() => {
        restart()
          .then(({ port }) => log.info({ label, port }, "sidecar restarted"))
          .catch((err) => {
            log.error({ label, err: String(err) }, "sidecar restart failed");
            this.emit("crashed", { label });
            this.surfaceCrashDialog(label);
          });
      }, backoffMs);
    });
  }

  private surfaceCrashDialog(label: string): void {
    void dialog
      .showMessageBox({
        type: "error",
        title: "DeepTutor stopped responding",
        message: `The ${label} service has crashed and could not be restarted.`,
        detail: "Open the logs for details, or restart the app to try again.",
        buttons: ["Restart", "Show Logs", "Quit"],
        defaultId: 0,
        cancelId: 2,
      })
      .then(({ response }) => {
        if (response === 0) {
          app.relaunch();
          app.exit(0);
        } else if (response === 1) {
          const { shell } = require("electron") as typeof import("electron");
          void shell.openPath(app.getPath("logs"));
        } else {
          app.exit(1);
        }
      });
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getBackendPort(): number {
    return this.python.port;
  }

  getFrontendPort(): number {
    return this.node.port;
  }

  getBackendUrl(): string {
    return `http://127.0.0.1:${this.python.port}`;
  }

  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    log.info("shutting down sidecars");

    const stopChild = (label: string, child: ChildProcess | null): Promise<void> =>
      new Promise((resolve) => {
        if (!child || child.exitCode !== null || child.signalCode !== null) {
          return resolve();
        }
        const timer = setTimeout(() => {
          log.warn({ label }, "SIGKILL after grace period");
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
          resolve();
        }, SHUTDOWN_GRACE_MS);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          child.kill("SIGTERM");
        } catch (err) {
          log.warn({ label, err: String(err) }, "SIGTERM failed");
          clearTimeout(timer);
          resolve();
        }
      });

    await Promise.all([
      stopChild("node", this.node.child),
      stopChild("python", this.python.child),
    ]);
    log.info("sidecars stopped");
  }
}

let managerSingleton: SidecarManager | null = null;

/**
 * Access the current global SidecarManager instance, if one has been set.
 *
 * @returns The current SidecarManager instance, or `null` if no manager is configured.
 */
export function getSidecarManager(): SidecarManager | null {
  return managerSingleton;
}

/**
 * Set the global SidecarManager instance used by the application.
 *
 * @param m - The SidecarManager to register as the module-level singleton
 */
export function setSidecarManager(m: SidecarManager): void {
  managerSingleton = m;
}
