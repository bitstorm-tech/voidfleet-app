import { installPalette } from "./data/palette.ts";
import { locale } from "./i18n/index.ts";
import { MatchController } from "./matchController.ts";
import { animationTimeScale, onSettingsChange } from "./settings.ts";
import { installCursor } from "./ui/cursor.ts";

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;

document.documentElement.lang = locale;
const applyAnimationSpeed = () =>
  document.documentElement.style.setProperty("--animation-time-scale", String(animationTimeScale()));
applyAnimationSpeed();
onSettingsChange(applyAnimationSpeed);
installPalette();
installCursor();
new MatchController(canvas, ui);
