import arrowUrl from "../../assets/cursors/cursor_arrow.svg";
import crosshairUrl from "../../assets/cursors/cursor_crosshair.svg";
import classicUrl from "../../assets/cursors/cursor_default.svg";
import deltaUrl from "../../assets/cursors/cursor_delta.svg";
import fighterUrl from "../../assets/cursors/cursor_fighter.svg";
import flagshipUrl from "../../assets/cursors/cursor_flagship.svg";
import formationUrl from "../../assets/cursors/cursor_formation.svg";
import holoUrl from "../../assets/cursors/cursor_holo.svg";
import needleUrl from "../../assets/cursors/cursor_needle.svg";
import shardUrl from "../../assets/cursors/cursor_shard.svg";
import thrusterUrl from "../../assets/cursors/cursor_thruster.svg";
import { onSettingsChange, settings } from "../settings.ts";

/** Wählbare Cursor (Einstellungen): Bild und Hotspot in SVG-Einheiten. */
export const CURSORS = {
  classic: { url: classicUrl, hotspot: [0, 0] },
  arrow: { url: arrowUrl, hotspot: [2, 2] },
  fighter: { url: fighterUrl, hotspot: [2, 2] },
  delta: { url: deltaUrl, hotspot: [2, 2] },
  flagship: { url: flagshipUrl, hotspot: [2, 2] },
  needle: { url: needleUrl, hotspot: [2, 2] },
  shard: { url: shardUrl, hotspot: [2, 2] },
  formation: { url: formationUrl, hotspot: [2, 2] },
  holo: { url: holoUrl, hotspot: [2, 2] },
  thruster: { url: thrusterUrl, hotspot: [2, 2] },
  crosshair: { url: crosshairUrl, hotspot: [16, 16] },
} as const;

export type CursorId = keyof typeof CURSORS;

/**
 * Kantenlänge des Quadrats, in das der Cursor eingepasst wird (CSS-Pixel). Chrome verwirft Cursor,
 * die in einer Richtung größer als 32 px sind, sobald sie über den Fensterrand ragen.
 */
const CURSOR_SIZE = 32;

/**
 * Setzt den gewählten Voidfleet-Cursor (wie in Godot für alles). Browser skalieren Cursor-Bilder
 * unscharf, deshalb wird das SVG für die aktuelle Pixeldichte gerastert und bei Monitor- oder
 * Cursorwechsel neu erzeugt.
 */
export function installCursor(): void {
  let shown: CursorId | undefined;
  let image: HTMLImageElement;

  const apply = () => {
    const dpr = window.devicePixelRatio;
    const scale = CURSOR_SIZE / Math.max(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(image.naturalWidth * scale * dpr);
    canvas.height = Math.floor(image.naturalHeight * scale * dpr);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const [x, y] = CURSORS[shown!].hotspot.map((value) => Math.round(value * scale));
    document.documentElement.style.setProperty("--cursor", `image-set(url("${canvas.toDataURL()}") ${dpr}x) ${x} ${y}, default`);
  };

  const select = async () => {
    if (settings.cursor === shown) return;
    const next = settings.cursor;
    const loaded = new Image();
    loaded.src = CURSORS[next].url;
    await loaded.decode();
    if (settings.cursor !== next) return;
    shown = next;
    image = loaded;
    apply();
  };

  const watchResolution = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        if (image) apply();
        watchResolution();
      },
      { once: true },
    );
  };

  select();
  watchResolution();
  onSettingsChange(select);
}
