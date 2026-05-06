import { app, BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";

interface WindowState {
  width: number;
  height: number;
  x: number | undefined;
  y: number | undefined;
  isMaximized: boolean;
  isFullScreen: boolean;
}

const DEFAULTS: WindowState = {
  width: 1280,
  height: 800,
  x: undefined,
  y: undefined,
  isMaximized: false,
  isFullScreen: false,
};

function statePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function clampToVisibleDisplay(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state;
  const bounds = { x: state.x, y: state.y, width: state.width, height: state.height };
  const display = screen.getDisplayMatching(bounds);
  const { workArea } = display;
  if (
    bounds.x >= workArea.x &&
    bounds.y >= workArea.y &&
    bounds.x + bounds.width <= workArea.x + workArea.width &&
    bounds.y + bounds.height <= workArea.y + workArea.height
  ) {
    return state;
  }
  return { ...state, x: undefined, y: undefined };
}

export function restoreWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    const merged: WindowState = { ...DEFAULTS, ...parsed };
    return clampToVisibleDisplay(merged);
  } catch {
    return { ...DEFAULTS };
  }
}

export function attachWindowStateListeners(window: BrowserWindow): void {
  let saveTimer: NodeJS.Timeout | null = null;
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const bounds = window.getNormalBounds();
        const state: WindowState = {
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y,
          isMaximized: window.isMaximized(),
          isFullScreen: window.isFullScreen(),
        };
        fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf8");
      } catch {
        // best-effort; window state is recoverable
      }
    }, 500);
  };

  window.on("resize", persist);
  window.on("move", persist);
  window.on("maximize", persist);
  window.on("unmaximize", persist);
  window.on("enter-full-screen", persist);
  window.on("leave-full-screen", persist);
  window.on("close", persist);
}
