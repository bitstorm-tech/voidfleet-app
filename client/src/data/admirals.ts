// Die Admirale im Client: ihre Porträts (`assets/images/admirals/<id>.jpg`) für Auswahlkarten, Fähigkeitskarte,
// Banner und Gegner-Feld, und welcher Admiral zu einem Flaggschiff bzw. einer Fähigkeit gehört. Regeln und
// Zahlen stehen in `shared/admirals.ts`, die Akzentfarben in `palette.ts`, Namen und Texte in `i18n/`.

import { ADMIRAL_IDS, ADMIRALS, type AdmiralId, type PowerId } from "../../../shared/admirals.ts";
import type { ShipId } from "../../../shared/cards.ts";
import halvorsen from "../../assets/images/admirals/halvorsen.jpg";
import kerr from "../../assets/images/admirals/kerr.jpg";
import moreau from "../../assets/images/admirals/moreau.jpg";
import osei from "../../assets/images/admirals/osei.jpg";
import vance from "../../assets/images/admirals/vance.jpg";

const PORTRAITS: Record<AdmiralId, string> = { osei, vance, halvorsen, moreau, kerr };

/** Der Admiral, dem das Flaggschiff gehört; null für jedes andere Schiff. */
export function flagshipAdmiral(id: ShipId): AdmiralId | null {
  return ADMIRAL_IDS.find((admiral) => ADMIRALS[admiral].flagship === id) ?? null;
}

/** Der Admiral, dem die Fähigkeit gehört. */
export function powerAdmiral(power: PowerId): AdmiralId {
  return ADMIRAL_IDS.find((admiral) => ADMIRALS[admiral].power === power)!;
}

/** URL des Porträts eines Admirals. */
export function admiralPortrait(admiral: AdmiralId): string {
  return PORTRAITS[admiral];
}

/** Die vorgeladenen Bilder bleiben referenziert, damit der Browser sie nicht wieder verwirft. */
const images: HTMLImageElement[] = [];

/** Lädt und dekodiert alle Porträts, damit die Auswahl ohne Verzögerung erscheint. */
export function loadPortraits(): Promise<void>[] {
  return Object.values(PORTRAITS).map((url) => {
    const image = new Image();
    image.src = url;
    images.push(image);
    return image.decode();
  });
}
