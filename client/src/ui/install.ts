// Installation als eigene App: Chrome und Edge melden mit `beforeinstallprompt`, dass die Seite
// installierbar ist (Manifest `assets/app/manifest.webmanifest`). Das Ereignis kommt früh, deshalb
// hört dieses Modul ab dem Start zu; der Einstellungsdialog zeigt den Knopf, solange es gilt.
// Daneben bleibt das Installieren über die Adressleiste des Browsers.

/** Fehlt in lib.dom, weil es (noch) kein Standard ist. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let pending: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(installable: boolean) => void>();

function notify(): void {
  for (const listener of listeners) listener(pending !== null);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  pending = event as BeforeInstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  pending = null;
  notify();
});

/** Ruft `listener` sofort und bei jeder Änderung, ob installiert werden kann. */
export function onInstallable(listener: (installable: boolean) => void): void {
  listeners.add(listener);
  listener(pending !== null);
}

/** Öffnet den Installationsdialog des Browsers. Das Ereignis taugt nur für einen Versuch; nach
 *  einer Absage meldet der Browser die Seite erst später wieder als installierbar. */
export function installApp(): void {
  void pending?.prompt();
  pending = null;
  notify();
}
