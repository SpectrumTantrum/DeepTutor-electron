import { spawn, type ChildProcess } from "node:child_process";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getLogger } from "./logger";
import { freePort } from "./ports";

const log = getLogger("python");

export interface PythonSpawnResult {
  readonly child: ChildProcess;
  readonly port: number;
  readonly dataDir: string;
}

export function pythonSidecarBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "py-sidecar", "deeptutor-server");
  }
  const fromEnv = process.env.DEEPTUTOR_DEV_PY_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  return path.join(repoRoot, "dist", "py-sidecar", "deeptutor-server");
}

export async function spawnPythonSidecar(
  baseEnv: Readonly<Record<string, string>>,
): Promise<PythonSpawnResult> {
  const port = await freePort();
  const dataDir = path.join(app.getPath("userData"), "deeptutor-data");
  fs.mkdirSync(dataDir, { recursive: true });

  const binary = pythonSidecarBinaryPath();
  if (!fs.existsSync(binary)) {
    throw new Error(
      `Python sidecar not found at ${binary}. Run scripts/build-py-sidecar.sh first.`,
    );
  }

  log.info({ binary, port, dataDir }, "spawning python sidecar");

  const child = spawn(binary, [], {
    cwd: path.dirname(binary),
    env: {
      ...process.env,
      ...baseEnv,
      BACKEND_PORT: String(port),
      DEEPTUTOR_DATA_DIR: dataDir,
      PYTHONUNBUFFERED: "1",
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

  return { child, port, dataDir };
}

export async function waitForPythonReady(
  port: number,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/v1/system/runtime-topology`;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("python readiness aborted");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        log.info({ port }, "python sidecar ready");
        return;
      }
    } catch {
      // expected during boot — keep polling
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `python sidecar did not become ready within ${timeoutMs}ms on port ${port}`,
  );
}
