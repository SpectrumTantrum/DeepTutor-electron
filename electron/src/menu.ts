import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { logsDirectory } from "./sidecars/logger";
import { openSettingsWindow } from "./settings-window";
import { promptForFiles } from "./file-handlers";

const isMac = process.platform === "darwin";

export function buildAppMenu(getMainWindow: () => BrowserWindow | null): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings…",
                accelerator: "Cmd+,",
                click: () => openSettingsWindow(),
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open PDF…",
          accelerator: "CmdOrCtrl+O",
          click: () => promptForFiles(getMainWindow()),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        ...(process.env.NODE_ENV !== "production"
          ? ([{ role: "toggleDevTools" }] as MenuItemConstructorOptions[])
          : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: () => void shell.openExternal("https://github.com/deeptutor/deeptutor"),
        },
        {
          label: "Report Issue",
          click: () => void shell.openExternal("https://github.com/deeptutor/deeptutor/issues/new"),
        },
        { type: "separator" },
        {
          label: "Show Logs",
          click: () => void shell.openPath(logsDirectory()),
        },
        {
          label: "About DeepTutor",
          click: async () => {
            const win = getMainWindow();
            const opts = {
              type: "info" as const,
              title: "About DeepTutor",
              message: "DeepTutor",
              detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
              buttons: ["OK"],
            };
            if (win) {
              await dialog.showMessageBox(win, opts);
            } else {
              await dialog.showMessageBox(opts);
            }
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
