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

/**
 * Path to the JSON file used to persist the BrowserWindow's state.
 *
 * @returns Filesystem path to "window-state.json" inside the application's user data directory
 */
function statePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

/**
 * Ensure the given window state is positioned within a visible display; if it is not, clear its coordinates to allow automatic placement.
 *
 * @param state - The window state to validate against available displays. `x` and `y` may be `undefined`.
 * @returns The original `state` if its bounds lie entirely within a display's work area, otherwise a copy with `x` and `y` set to `undefined`.
 */
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

/**
 * Restore persisted BrowserWindow size, position, and state from disk.
 *
 * Reads the saved window state file, merges it with default values, and
 * adjusts the position so the window will appear on a visible display.
 *
 * @returns A complete `WindowState` (width, height, x, y, isMaximized, isFullScreen).
 * Position fields (`x`, `y`) will be `undefined` if no valid persisted position exists
 * or if the saved position falls outside available displays. If the state file cannot
 * be read or parsed, a copy of `DEFAULTS` is returned.
 */
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

/**
 * Start persisting the BrowserWindow's size, position, and maximized/full-screen state to disk and keep it up to date.
 *
 * Attaches listeners to the provided BrowserWindow so its normal bounds and state are written to the window-state JSON file
 * when the window is moved, resized, maximized/unmaximized, enters/leaves full screen, or closes. Saves are debounced (500ms)
 * to coalesce rapid changes. File writes are best-effort; I/O errors are ignored.
 *
 * @param window - The BrowserWindow whose state should be observed and persisted
 */
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
