import cursorUrl from "../../assets/cursors/cursor_default.svg";

/**
 * Kantenlänge des Quadrats, in das der Cursor eingepasst wird (CSS-Pixel). Chrome verwirft Cursor,
 * die in einer Richtung größer als 32 px sind, sobald sie über den Fensterrand ragen.
 */
const CURSOR_SIZE = 32;

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
    const scale = (CURSOR_SIZE * dpr) / Math.max(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(image.naturalWidth * scale);
    canvas.height = Math.floor(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    document.documentElement.style.setProperty(
      "--cursor",
      `image-set(url("${canvas.toDataURL()}") ${dpr}x) 0 0, default`,
    );
    matchMedia(`(resolution: ${dpr}dppx)`).addEventListener("change", apply, { once: true });
  };
  apply();
}
