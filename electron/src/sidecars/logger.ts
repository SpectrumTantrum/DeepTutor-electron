import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import pino, { type Logger } from "pino";

const loggers = new Map<string, Logger>();

function ensureLogDir(): string {
  const dir = app.getPath("logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

export function logsDirectory(): string {
  return ensureLogDir();
}
