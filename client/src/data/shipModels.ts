// 3D-Modelle der Schiffskarten, gebaut mit `tools/ships/` in Blender (glTF, Nase nach +Z).

import type { ShipCard } from "../../../shared/cards.ts";
import horizon_cruiser from "../../assets/models/ships/horizon_cruiser.glb";
import iron_dreadnought from "../../assets/models/ships/iron_dreadnought.glb";
import plasma_frigate from "../../assets/models/ships/plasma_frigate.glb";
import repair_drone from "../../assets/models/ships/repair_drone.glb";
import scrap_raider from "../../assets/models/ships/scrap_raider.glb";
import signal_booster from "../../assets/models/ships/signal_booster.glb";
import titan_carrier from "../../assets/models/ships/titan_carrier.glb";
import void_interceptor from "../../assets/models/ships/void_interceptor.glb";

const MODELS: Record<ShipCard["id"], string> = {
  horizon_cruiser,
  iron_dreadnought,
  plasma_frigate,
  repair_drone,
  scrap_raider,
  signal_booster,
  titan_carrier,
  void_interceptor,
};

/** URL des Modells einer Schiffskarte. */
export function shipModel(card: ShipCard): string {
  return MODELS[card.id];
}
