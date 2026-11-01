// Preload des Spielfensters: gibt dem Client Zugriff auf die Einstellungsdatei, die der Hauptprozess verwaltet, und auf
// den Fenstermodus (`window.voidfleetDesktop`, siehe `client/src/settings.ts` und `client/src/ui/fullscreen.ts`).

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("voidfleetDesktop", {
  settings: ipcRenderer.sendSync("settings:load") as string | null,
  saveSettings: (json: string) => ipcRenderer.send("settings:save", json),
  windowMode: ipcRenderer.sendSync("window:mode:get") as string,
  setWindowMode: (mode: string) => ipcRenderer.send("window:mode", mode),
  onWindowModeChange: (listener: (mode: string) => void) => ipcRenderer.on("window:mode", (_event, mode: string) => listener(mode)),
});
