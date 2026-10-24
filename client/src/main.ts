import { installUiSounds } from "./audio/uiSounds.ts";
import { installPalette } from "./data/palette.ts";
import { locale } from "./i18n/index.ts";
import { MatchController } from "./matchController.ts";
import { installCursor } from "./ui/cursor.ts";

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;

document.documentElement.lang = locale;
installPalette();
installCursor();
installUiSounds(ui);
new MatchController(canvas, ui);
