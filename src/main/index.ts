import { app, shell, BrowserWindow, Menu } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { registerIpc } from "./ipc";
import { sessionManager } from "./session-manager";

// package.json name 已从 ssh-client 改为 ssh-client-plus，
// 但 userData 路径必须保持旧值，否则已有用户升级后找不到保险库数据。
app.setPath("userData", join(app.getPath("appData"), "ssh-client"));

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: "SSH Client Plus",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 去掉默认菜单，避免 Alt 呼出 File/Edit 菜单栏
  mainWindow.setMenu(null);

  sessionManager.setWindow(mainWindow);

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    sessionManager.setWindow(null);
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.sshclient.app");
  Menu.setApplicationMenu(null);

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
    window.setMenu(null);
  });

  registerIpc(() => mainWindow);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  sessionManager.disconnectAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  sessionManager.disconnectAll();
});
