// Funksprüche des Bordfunks (`audio/radio.ts`), erzeugt mit `tools/generateAudio.ts` (ElevenLabs Text-to-Speech)
// als `assets/audio/radio/<id>_<n>.mp3`, je Variante eine Datei; ihr gesprochener Text steht in `i18n/en.ts` (`radio`).
// Die Priorität entscheidet, wer bei belegtem Funk warten darf und sich wiederholen darf: 3 sind Verluste, Angriffe
// auf die eigene Flotte und der Ausgang des Matches, 2 Meldungen über den Gegner und den Verlauf, 1 Bestätigungen
// eigener Befehle und Fähigkeiten.

import barrage_caught_1 from "../../assets/audio/radio/barrage_caught_1.mp3";
import barrage_caught_2 from "../../assets/audio/radio/barrage_caught_2.mp3";
import barrage_hit_1 from "../../assets/audio/radio/barrage_hit_1.mp3";
import barrage_hit_2 from "../../assets/audio/radio/barrage_hit_2.mp3";
import barrage_missed_1 from "../../assets/audio/radio/barrage_missed_1.mp3";
import battle_start_1 from "../../assets/audio/radio/battle_start_1.mp3";
import battle_start_2 from "../../assets/audio/radio/battle_start_2.mp3";
import defeat_1 from "../../assets/audio/radio/defeat_1.mp3";
import defeat_2 from "../../assets/audio/radio/defeat_2.mp3";
import draw_1 from "../../assets/audio/radio/draw_1.mp3";
import drone_launch_1 from "../../assets/audio/radio/drone_launch_1.mp3";
import emp_hit_1 from "../../assets/audio/radio/emp_hit_1.mp3";
import emp_incoming_1 from "../../assets/audio/radio/emp_incoming_1.mp3";
import enemy_destroyed_1 from "../../assets/audio/radio/enemy_destroyed_1.mp3";
import enemy_destroyed_2 from "../../assets/audio/radio/enemy_destroyed_2.mp3";
import enemy_destroyed_3 from "../../assets/audio/radio/enemy_destroyed_3.mp3";
import enemy_destroyed_4 from "../../assets/audio/radio/enemy_destroyed_4.mp3";
import enemy_ready_1 from "../../assets/audio/radio/enemy_ready_1.mp3";
import enemy_ready_2 from "../../assets/audio/radio/enemy_ready_2.mp3";
import enemy_surrender_1 from "../../assets/audio/radio/enemy_surrender_1.mp3";
import flanking_1 from "../../assets/audio/radio/flanking_1.mp3";
import frigate_fire_1 from "../../assets/audio/radio/frigate_fire_1.mp3";
import hull_critical_1 from "../../assets/audio/radio/hull_critical_1.mp3";
import hull_critical_2 from "../../assets/audio/radio/hull_critical_2.mp3";
import intercept_1 from "../../assets/audio/radio/intercept_1.mp3";
import jammed_1 from "../../assets/audio/radio/jammed_1.mp3";
import jammer_1 from "../../assets/audio/radio/jammer_1.mp3";
import last_ship_1 from "../../assets/audio/radio/last_ship_1.mp3";
import last_ship_2 from "../../assets/audio/radio/last_ship_2.mp3";
import orbital_incoming_1 from "../../assets/audio/radio/orbital_incoming_1.mp3";
import orbital_strike_1 from "../../assets/audio/radio/orbital_strike_1.mp3";
import orders_sent_1 from "../../assets/audio/radio/orders_sent_1.mp3";
import orders_sent_2 from "../../assets/audio/radio/orders_sent_2.mp3";
import orders_sent_3 from "../../assets/audio/radio/orders_sent_3.mp3";
import overcharge_1 from "../../assets/audio/radio/overcharge_1.mp3";
import overdrive_1 from "../../assets/audio/radio/overdrive_1.mp3";
import overdrive_2 from "../../assets/audio/radio/overdrive_2.mp3";
import overdrive_up_1 from "../../assets/audio/radio/overdrive_up_1.mp3";
import overdrive_up_2 from "../../assets/audio/radio/overdrive_up_2.mp3";
import power_surge_1 from "../../assets/audio/radio/power_surge_1.mp3";
import recall_1 from "../../assets/audio/radio/recall_1.mp3";
import repair_1 from "../../assets/audio/radio/repair_1.mp3";
import retreat_1 from "../../assets/audio/radio/retreat_1.mp3";
import scavenge_1 from "../../assets/audio/radio/scavenge_1.mp3";
import scrap_1 from "../../assets/audio/radio/scrap_1.mp3";
import shields_up_1 from "../../assets/audio/radio/shields_up_1.mp3";
import shields_up_2 from "../../assets/audio/radio/shields_up_2.mp3";
import ship_lost_1 from "../../assets/audio/radio/ship_lost_1.mp3";
import ship_lost_2 from "../../assets/audio/radio/ship_lost_2.mp3";
import ship_lost_3 from "../../assets/audio/radio/ship_lost_3.mp3";
import torpedo_away_1 from "../../assets/audio/radio/torpedo_away_1.mp3";
import torpedo_away_2 from "../../assets/audio/radio/torpedo_away_2.mp3";
import torpedo_dodged_1 from "../../assets/audio/radio/torpedo_dodged_1.mp3";
import torpedo_dodged_2 from "../../assets/audio/radio/torpedo_dodged_2.mp3";
import torpedo_hit_1 from "../../assets/audio/radio/torpedo_hit_1.mp3";
import torpedo_hit_2 from "../../assets/audio/radio/torpedo_hit_2.mp3";
import torpedo_incoming_1 from "../../assets/audio/radio/torpedo_incoming_1.mp3";
import torpedo_incoming_2 from "../../assets/audio/radio/torpedo_incoming_2.mp3";
import torpedo_missed_1 from "../../assets/audio/radio/torpedo_missed_1.mp3";
import torpedo_missed_2 from "../../assets/audio/radio/torpedo_missed_2.mp3";
import victory_1 from "../../assets/audio/radio/victory_1.mp3";
import victory_2 from "../../assets/audio/radio/victory_2.mp3";
import volley_1 from "../../assets/audio/radio/volley_1.mp3";
import volley_incoming_1 from "../../assets/audio/radio/volley_incoming_1.mp3";
import type { RadioCue, RadioLines } from "../i18n/en.ts";

export type { RadioCue };

/** Je Funkspruch eine Datei pro Variante, so viele wie Untertitel in `RadioLines`. */
export const RADIO: { [Cue in RadioCue]: { files: RadioLines[Cue]; priority: 1 | 2 | 3 } } = {
  battle_start: { files: [battle_start_1, battle_start_2], priority: 2 },
  orders_sent: { files: [orders_sent_1, orders_sent_2, orders_sent_3], priority: 1 },
  enemy_ready: { files: [enemy_ready_1, enemy_ready_2], priority: 2 },
  overdrive: { files: [overdrive_1, overdrive_2], priority: 2 },
  overdrive_up: { files: [overdrive_up_1, overdrive_up_2], priority: 2 },
  last_ship: { files: [last_ship_1, last_ship_2], priority: 3 },
  victory: { files: [victory_1, victory_2], priority: 3 },
  defeat: { files: [defeat_1, defeat_2], priority: 3 },
  draw: { files: [draw_1], priority: 3 },
  enemy_surrender: { files: [enemy_surrender_1], priority: 3 },
  retreat: { files: [retreat_1], priority: 3 },
  torpedo_away: { files: [torpedo_away_1, torpedo_away_2], priority: 1 },
  torpedo_hit: { files: [torpedo_hit_1, torpedo_hit_2], priority: 2 },
  torpedo_missed: { files: [torpedo_missed_1, torpedo_missed_2], priority: 2 },
  torpedo_incoming: { files: [torpedo_incoming_1, torpedo_incoming_2], priority: 3 },
  torpedo_dodged: { files: [torpedo_dodged_1, torpedo_dodged_2], priority: 2 },
  barrage_hit: { files: [barrage_hit_1, barrage_hit_2], priority: 2 },
  barrage_missed: { files: [barrage_missed_1], priority: 2 },
  barrage_caught: { files: [barrage_caught_1, barrage_caught_2], priority: 2 },
  orbital_strike: { files: [orbital_strike_1], priority: 1 },
  orbital_incoming: { files: [orbital_incoming_1], priority: 2 },
  volley: { files: [volley_1], priority: 1 },
  volley_incoming: { files: [volley_incoming_1], priority: 2 },
  emp_hit: { files: [emp_hit_1], priority: 2 },
  emp_incoming: { files: [emp_incoming_1], priority: 2 },
  jammer: { files: [jammer_1], priority: 1 },
  jammed: { files: [jammed_1], priority: 2 },
  shields_up: { files: [shields_up_1, shields_up_2], priority: 1 },
  overcharge: { files: [overcharge_1], priority: 1 },
  power_surge: { files: [power_surge_1], priority: 1 },
  scavenge: { files: [scavenge_1], priority: 1 },
  intercept: { files: [intercept_1], priority: 1 },
  recall: { files: [recall_1], priority: 1 },
  flanking: { files: [flanking_1], priority: 1 },
  drone_launch: { files: [drone_launch_1], priority: 1 },
  frigate_fire: { files: [frigate_fire_1], priority: 1 },
  repair: { files: [repair_1], priority: 1 },
  scrap: { files: [scrap_1], priority: 1 },
  enemy_destroyed: { files: [enemy_destroyed_1, enemy_destroyed_2, enemy_destroyed_3, enemy_destroyed_4], priority: 2 },
  ship_lost: { files: [ship_lost_1, ship_lost_2, ship_lost_3], priority: 3 },
  hull_critical: { files: [hull_critical_1, hull_critical_2], priority: 2 },
};
