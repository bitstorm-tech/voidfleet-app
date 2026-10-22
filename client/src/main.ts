import { locale } from "./i18n/index.ts";
import { MatchController } from "./matchController.ts";
import { ANIMATION_TIME_SCALE } from "./scene/tween.ts";
import { installCursor } from "./ui/cursor.ts";

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;

document.documentElement.lang = locale;
document.documentElement.style.setProperty("--animation-time-scale", String(ANIMATION_TIME_SCALE));
installCursor();
new MatchController(canvas, ui);
