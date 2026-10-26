// Kartenillustrationen, erzeugt mit `tools/generateCardArt.ts` (fal.ai).

import type { Card } from "../../../shared/cards.ts";
import horizon_cruiser from "../../assets/images/cards/horizon_cruiser.jpg";
import iron_dreadnought from "../../assets/images/cards/iron_dreadnought.jpg";
import plasma_frigate from "../../assets/images/cards/plasma_frigate.jpg";
import repair_drone from "../../assets/images/cards/repair_drone.jpg";
import scrap_raider from "../../assets/images/cards/scrap_raider.jpg";
import signal_booster from "../../assets/images/cards/signal_booster.jpg";
import titan_carrier from "../../assets/images/cards/titan_carrier.jpg";
import void_interceptor from "../../assets/images/cards/void_interceptor.jpg";
import drone from "../../assets/images/cards/drone.jpg";
import decoy from "../../assets/images/cards/decoy.jpg";
import bastion from "../../assets/images/cards/bastion.jpg";
import vanguard from "../../assets/images/cards/vanguard.jpg";
import hive from "../../assets/images/cards/hive.jpg";
import mirage from "../../assets/images/cards/mirage.jpg";
import pendulum from "../../assets/images/cards/pendulum.jpg";
import emergency_shields from "../../assets/images/cards/emergency_shields.jpg";
import emp_blast from "../../assets/images/cards/emp_blast.jpg";
import flanking_maneuver from "../../assets/images/cards/flanking_maneuver.jpg";
import intercept from "../../assets/images/cards/intercept.jpg";
import orbital_strike from "../../assets/images/cards/orbital_strike.jpg";
import overcharge from "../../assets/images/cards/overcharge.jpg";
import power_surge from "../../assets/images/cards/power_surge.jpg";
import recall from "../../assets/images/cards/recall.jpg";
import scavenge from "../../assets/images/cards/scavenge.jpg";
import targeting_jammer from "../../assets/images/cards/targeting_jammer.jpg";
import volley_fire from "../../assets/images/cards/volley_fire.jpg";
import torpedo from "../../assets/images/cards/torpedo.jpg";
import barrage from "../../assets/images/cards/barrage.jpg";

const ART: Record<Card["id"], string> = {
  horizon_cruiser,
  iron_dreadnought,
  plasma_frigate,
  repair_drone,
  scrap_raider,
  signal_booster,
  titan_carrier,
  void_interceptor,
  drone,
  decoy,
  bastion,
  vanguard,
  hive,
  mirage,
  pendulum,
  emergency_shields,
  emp_blast,
  flanking_maneuver,
  intercept,
  orbital_strike,
  overcharge,
  power_surge,
  recall,
  scavenge,
  targeting_jammer,
  volley_fire,
  torpedo,
  barrage,
};

/** URL der Illustration einer Karte. */
export function cardArt(card: Card): string {
  return ART[card.id];
}

/** Die vorgeladenen Bilder bleiben referenziert, damit der Browser sie nicht wieder verwirft. */
const images: HTMLImageElement[] = [];

/** Lädt und dekodiert alle Illustrationen, damit Karten ohne Verzögerung erscheinen. */
export function loadCardArt(): Promise<void>[] {
  return Object.values(ART).map((url) => {
    const image = new Image();
    image.src = url;
    images.push(image);
    return image.decode();
  });
}
