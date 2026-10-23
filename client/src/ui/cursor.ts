import cursorUrl from "../../assets/cursors/cursor_default.svg";

/** Höhe des Cursors in CSS-Pixeln. Chrome verwirft Cursor über 32 px am Fensterrand. */
const CURSOR_HEIGHT = 32;

/**
 * Setzt den Voidfleet-Cursor (wie in Godot für alles, Hotspot an der Spitze).
 * Browser skalieren Cursor-Bilder unscharf, deshalb wird das SVG für die
 * aktuelle Pixeldichte gerastert und bei Monitorwechsel neu erzeugt.
 */
export async function installCursor(): Promise<void> {
  const image = new Image();
  image.src = cursorUrl;
  await image.decode();

  const apply = () => {
    const dpr = window.devicePixelRatio;
    const canvas = document.createElement("canvas");
    canvas.height = Math.round(CURSOR_HEIGHT * dpr);
    canvas.width = Math.round((CURSOR_HEIGHT * dpr * image.naturalWidth) / image.naturalHeight);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    document.documentElement.style.setProperty(
      "--cursor",
      `image-set(url("${canvas.toDataURL()}") ${dpr}x) 0 0, default`,
    );
    matchMedia(`(resolution: ${dpr}dppx)`).addEventListener("change", apply, { once: true });
  };
  apply();
}
