import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import pino, { type Logger } from "pino";

const loggers = new Map<string, Logger>();

/**
 * Ensures the Electron application's logs directory exists and returns its path.
 *
 * Creates the directory if it does not already exist.
 *
 * @returns The absolute path to the application's logs directory.
 */
function ensureLogDir(): string {
  const dir = app.getPath("logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create or retrieve a named Logger configured to write to a per-name log file with rotation and environment-appropriate targets.
 *
 * @param name - Identifier for the logger; used as the logger's name and to derive the log filename (`<name>.log`)
 * @returns The configured `Logger` instance for the given name
 */
export function getLogger(name: string): Logger {
  const cached = loggers.get(name);
  if (cached) return cached;

  const dir = ensureLogDir();
  const logFile = path.join(dir, `${name}.log`);

  const transport = pino.transport({
    targets: [
      {
        target: "pino-roll",
        options: {
          file: logFile,
          frequency: "daily",
          mkdir: true,
          size: "10m",
          limit: { count: 7 },
        },
        level: "info",
      },
      ...(process.env.NODE_ENV !== "production"
        ? [
            {
              target: "pino/file",
              options: { destination: 2 },
              level: "debug",
            },
          ]
        : []),
    ],
  });

  const logger = pino(
    { name, level: process.env.NODE_ENV === "production" ? "info" : "debug" },
    transport,
  );
  loggers.set(name, logger);
  return logger;
}

/**
 * Get the application's logs directory, creating it if it does not exist.
 *
 * @returns The absolute path to the logs directory; the directory is created if missing.
 */
export function logsDirectory(): string {
  return ensureLogDir();
}
