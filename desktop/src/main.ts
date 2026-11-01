// Electron-Hauptprozess der Desktop-App: startet den kompilierten Spielserver (`voidfleet-server`,
// eine Bun-Binary mit eingebettetem Client) auf einem freien Port von 127.0.0.1 und zeigt ihn in
// einem Fenster. Der Server endet mit der App. Das Fenster öffnet im zuletzt gewählten Modus (Fenster, maximiert oder
// Vollbild); der Client schaltet ihn per IPC um und erfährt jeden Wechsel, auch per F11 oder über die Titelleiste.

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";

const SERVER_BINARY = process.platform === "win32" ? "voidfleet-server.exe" : "voidfleet-server";

// Chromium sperrt WebGL auf manchen (v. a. Linux-)Treibern; das Spiel soll trotzdem die GPU nutzen.
app.commandLine.appendSwitch("ignore-gpu-blocklist");

let server: ChildProcess | null = null;

/** Die Einstellungen des Clients liegen als Datei im Datenordner der App statt im `localStorage`, der am Origin samt
 *  (bei jedem Start anderem) Port hängt; `preload.ts` reicht sie durch. */
function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function readSettings(): string | null {
  try {
    return readFileSync(settingsPath(), "utf8");
  } catch {
    return null;
  }
}

ipcMain.on("settings:load", (event) => (event.returnValue = readSettings()));
ipcMain.on("settings:save", (_event, json: string) => writeFileSync(settingsPath(), json));

/** Gepackt tragen Windows- und macOS-App das Icon selbst, Linux braucht es am Fenster und das Dock
 *  von macOS beim Entwickeln (sonst zeigt es das Icon des Electron-Binarys). */
function iconPath(): string {
  return join(app.getAppPath(), "dist", "icon.png");
}

/** Lässt das Betriebssystem einen freien Port wählen. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("kein Port"))));
    });
  });
}

/** Startet den Server und wartet, bis er seine Startzeile ausgibt. */
async function startServer(): Promise<string> {
  const port = await freePort();
  // Gepackt liegt die Binary in den Ressourcen der App, beim Entwickeln in `desktop/dist/`.
  const binary = app.isPackaged ? join(process.resourcesPath, SERVER_BINARY) : join(app.getAppPath(), "dist", SERVER_BINARY);
  const child = spawn(binary, [], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "inherit"] });
  server = child;
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Server beendet (Code ${code})`)));
    child.stdout!.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      if (chunk.toString().includes("läuft auf")) resolve(`http://127.0.0.1:${port}/`);
    });
  });
}

type WindowMode = "windowed" | "maximized" | "fullscreen";

function windowMode(window: BrowserWindow): WindowMode {
  return window.isFullScreen() ? "fullscreen" : window.isMaximized() ? "maximized" : "windowed";
}

/** Aus dem Vollbild heraus maximiert oder verkleinert es erst, wenn das Vollbild verlassen ist; sonst setzt das System
 *  den Zustand von vor dem Vollbild wieder ein. */
function setWindowMode(window: BrowserWindow, mode: WindowMode): void {
  if (mode === "fullscreen") return window.setFullScreen(true);
  const finish = () => (mode === "maximized" ? window.maximize() : window.unmaximize());
  if (!window.isFullScreen()) return finish();
  window.once("leave-full-screen", finish);
  window.setFullScreen(false);
}

function createWindow(url: string): void {
  const saved = (JSON.parse(readSettings() ?? "{}") as { windowMode?: WindowMode }).windowMode ?? "maximized";
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: "Voidfleet",
    backgroundColor: "#04050a",
    icon: iconPath(),
    show: false,
    fullscreen: saved === "fullscreen",
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false, preload: join(app.getAppPath(), "dist", "preload.js") },
  });
  window.once("ready-to-show", () => {
    if (saved === "maximized") window.maximize();
    window.show();
  });
  ipcMain.on("window:mode", (event, mode: WindowMode) => {
    if (event.sender === window.webContents) setWindowMode(window, mode);
  });
  ipcMain.on("window:mode:get", (event) => (event.returnValue = saved));
  const report = () => window.webContents.send("window:mode", windowMode(window));
  window.on("enter-full-screen", report);
  window.on("leave-full-screen", report);
  window.on("maximize", report);
  window.on("unmaximize", report);
  // Links nach außen (etwa Quellen) öffnen im Browser, nicht in einem zweiten Spielfenster.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  // F11 schaltet Vollbild, F12 die Entwicklerwerkzeuge.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") window.setFullScreen(!window.isFullScreen());
    else if (input.key === "F12") window.webContents.toggleDevTools();
    else return;
    event.preventDefault();
  });
  void window.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  Menu.setApplicationMenu(null);
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => server?.kill());
  app.whenReady().then(async () => {
    app.dock?.setIcon(iconPath());
    try {
      createWindow(await startServer());
    } catch (error) {
      dialog.showErrorBox("Voidfleet", `Der Spielserver startet nicht: ${error instanceof Error ? error.message : error}`);
      app.quit();
    }
  });
}
