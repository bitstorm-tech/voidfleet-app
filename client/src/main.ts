import { MatchController } from "./matchController.ts";

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;

new MatchController(canvas, ui);
