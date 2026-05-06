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

export function webStandalonePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "web", "server.js");
  }
  const fromEnv = process.env.DEEPTUTOR_DEV_WEB_SERVER;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  return path.join(repoRoot, "web", ".next", "standalone", "server.js");
}

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
