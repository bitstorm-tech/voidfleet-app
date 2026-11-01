// Preload des Spielfensters: gibt dem Client Zugriff auf die Einstellungsdatei, die der Hauptprozess verwaltet
// (`window.voidfleetDesktop`, siehe `client/src/settings.ts`).

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("voidfleetDesktop", {
  settings: ipcRenderer.sendSync("settings:load") as string | null,
  saveSettings: (json: string) => ipcRenderer.send("settings:save", json),
});
