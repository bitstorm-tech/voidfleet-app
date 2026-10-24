// 3D-Modelle der Schiffskarten, gebaut mit `tools/ships/` in Blender (glTF, Nase nach +Z).
// Zu jedem Schiff gehört ein Wrack aus Bruchstücken (`<id>_wreck.glb`, `tools/ships/wreck.py`)
// im selben Modellraum, das bei der Zerstörung an die Stelle des Schiffs tritt.

import type { ShipCard } from "../../../shared/cards.ts";
import drone from "../../assets/models/ships/drone.glb";
import drone_wreck from "../../assets/models/ships/drone_wreck.glb";
import horizon_cruiser from "../../assets/models/ships/horizon_cruiser.glb";
import horizon_cruiser_wreck from "../../assets/models/ships/horizon_cruiser_wreck.glb";
import iron_dreadnought from "../../assets/models/ships/iron_dreadnought.glb";
import iron_dreadnought_wreck from "../../assets/models/ships/iron_dreadnought_wreck.glb";
import plasma_frigate from "../../assets/models/ships/plasma_frigate.glb";
import plasma_frigate_wreck from "../../assets/models/ships/plasma_frigate_wreck.glb";
import repair_drone from "../../assets/models/ships/repair_drone.glb";
import repair_drone_wreck from "../../assets/models/ships/repair_drone_wreck.glb";
import scrap_raider from "../../assets/models/ships/scrap_raider.glb";
import scrap_raider_wreck from "../../assets/models/ships/scrap_raider_wreck.glb";
import signal_booster from "../../assets/models/ships/signal_booster.glb";
import signal_booster_wreck from "../../assets/models/ships/signal_booster_wreck.glb";
import titan_carrier from "../../assets/models/ships/titan_carrier.glb";
import titan_carrier_wreck from "../../assets/models/ships/titan_carrier_wreck.glb";
import void_interceptor from "../../assets/models/ships/void_interceptor.glb";
import void_interceptor_wreck from "../../assets/models/ships/void_interceptor_wreck.glb";

const MODELS: Record<ShipCard["id"], { ship: string; wreck: string }> = {
  drone: { ship: drone, wreck: drone_wreck },
  horizon_cruiser: { ship: horizon_cruiser, wreck: horizon_cruiser_wreck },
  iron_dreadnought: { ship: iron_dreadnought, wreck: iron_dreadnought_wreck },
  plasma_frigate: { ship: plasma_frigate, wreck: plasma_frigate_wreck },
  repair_drone: { ship: repair_drone, wreck: repair_drone_wreck },
  scrap_raider: { ship: scrap_raider, wreck: scrap_raider_wreck },
  signal_booster: { ship: signal_booster, wreck: signal_booster_wreck },
  titan_carrier: { ship: titan_carrier, wreck: titan_carrier_wreck },
  void_interceptor: { ship: void_interceptor, wreck: void_interceptor_wreck },
};

/** URL des Modells einer Schiffskarte. */
export function shipModel(card: ShipCard): string {
  return MODELS[card.id].ship;
}

/** URL der Bruchstücke, in die das Schiff bei der Zerstörung zerfällt. */
export function wreckModel(card: ShipCard): string {
  return MODELS[card.id].wreck;
}

/** URLs aller Modelle und Wracks. */
export function allShipModels(): string[] {
  return Object.values(MODELS).flatMap(({ ship, wreck }) => [ship, wreck]);
}
