import { spawn, type ChildProcess } from "node:child_process";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getLogger } from "./logger";
import { freePort } from "./ports";

const log = getLogger("web");

export interface NodeSpawnResult {
  readonly child: ChildProcess;
  readonly port: number;
}

/**
 * Resolve the filesystem path to the web sidecar's standalone server.js.
 *
 * When the app is packaged, returns the file under the app's resources (resourcesPath/web/server.js).
 * If the DEEPTUTOR_DEV_WEB_SERVER environment variable points to an existing file, that path is returned.
 * Otherwise returns the development standalone server path inside the repository (web/.next/standalone/server.js).
 *
 * @returns The absolute filesystem path to the web sidecar's `server.js`.
 */
export function webStandalonePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "web", "server.js");
  }
  const fromEnv = process.env.DEEPTUTOR_DEV_WEB_SERVER;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  return path.join(repoRoot, "web", ".next", "standalone", "server.js");
}

/**
 * Spawns the Node.js web sidecar on an available port and returns the child process and port.
 *
 * @param backendPort - Port of the local backend API that will be exposed to the sidecar via NEXT_PUBLIC_API_BASE
 * @param appVersion - Application version to propagate into the sidecar environment (APP_VERSION / NEXT_PUBLIC_APP_VERSION)
 * @returns An object containing the spawned ChildProcess (`child`) and the allocated port (`port`)
 * @throws If the sidecar server script cannot be found at the resolved path
 */
export async function spawnNodeSidecar(
  backendPort: number,
  appVersion: string,
): Promise<NodeSpawnResult> {
  const port = await freePort();
  const serverJs = webStandalonePath();
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `web/server.js not found at ${serverJs}. Run scripts/build-web-sidecar.sh (cd web && npm run build) first.`,
    );
  }

  const apiBase = `http://127.0.0.1:${backendPort}`;
  log.info({ serverJs, port, apiBase }, "spawning node sidecar");

  const child = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_PUBLIC_API_BASE: apiBase,
      NEXT_PUBLIC_API_BASE_EXTERNAL: apiBase,
      APP_VERSION: appVersion,
      NEXT_PUBLIC_APP_VERSION: appVersion,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim()) log.info({ stream: "stdout" }, line);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim()) log.warn({ stream: "stderr" }, line);
    }
  });

  return { child, port };
}

/**
 * Waits until the Node.js sidecar responds on the specified port or the wait times out.
 *
 * @param port - TCP port where the sidecar is expected to listen
 * @param timeoutMs - Maximum time in milliseconds to wait for readiness (default: 15000)
 * @param signal - Optional AbortSignal to cancel waiting early
 * @returns Resolves when the sidecar returns an HTTP status in the range 200–499
 * @throws Error when `signal` is aborted (throws "node readiness aborted")
 * @throws Error if the sidecar does not become ready within `timeoutMs` (throws a timeout error)
 */
export async function waitForNodeReady(
  port: number,
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/`;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("node readiness aborted");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.status >= 200 && res.status < 500) {
        log.info({ port }, "node sidecar ready");
        return;
      }
    } catch {
      // expected during boot
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `node sidecar did not become ready within ${timeoutMs}ms on port ${port}`,
  );
}
