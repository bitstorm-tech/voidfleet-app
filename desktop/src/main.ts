// Electron-Hauptprozess der Desktop-App: startet den kompilierten Spielserver (`voidfleet-server`,
// eine Bun-Binary mit eingebettetem Client) auf einem freien Port von 127.0.0.1 und zeigt ihn in
// einem Fenster. Der Server endet mit der App.

import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";

const SERVER_BINARY = process.platform === "win32" ? "voidfleet-server.exe" : "voidfleet-server";

// Chromium sperrt WebGL auf manchen (v. a. Linux-)Treibern; das Spiel soll trotzdem die GPU nutzen.
app.commandLine.appendSwitch("ignore-gpu-blocklist");

let server: ChildProcess | null = null;

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

function createWindow(url: string): void {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: "Voidfleet",
    backgroundColor: "#04050a",
    // Windows und macOS nehmen das Icon der ausführbaren Datei, Linux braucht es am Fenster.
    icon: join(app.getAppPath(), "dist", "icon.png"),
    show: false,
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false },
  });
  window.once("ready-to-show", () => window.show());
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
    try {
      createWindow(await startServer());
    } catch (error) {
      dialog.showErrorBox("Voidfleet", `Der Spielserver startet nicht: ${error instanceof Error ? error.message : error}`);
      app.quit();
    }
  });
}
