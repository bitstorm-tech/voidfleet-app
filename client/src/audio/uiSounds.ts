// Klänge der Oberfläche, im Code synthetisiert statt aus Dateien: kurze Töne und gefiltertes Rauschen mit
// schnellen Hüllkurven, alle durch einen Tiefpass, damit nichts schrill wird. Klicks auf Knöpfe, Auswahlen in
// Dialogen und das Überfahren der Karten hängen zentral an `installUiSounds`; was eine Aktion bedeutet
// (Auswahl, Platzieren, Rücknahme, Zug beenden …), meldet der Aufrufer mit `playUiSound`.

import { context, effectsBus, isAudible } from "./mixer.ts";

const output = new BiquadFilterNode(context, { type: "lowpass", frequency: 3500 });
output.connect(effectsBus);

/** Weißes Rauschen für das Wischen einer Karte. */
const noise = new AudioBuffer({ length: Math.round(context.sampleRate * 0.3), sampleRate: context.sampleRate });
noise.getChannelData(0).forEach((_, index, data) => (data[index] = Math.random() * 2 - 1));

/** Je Klang die Töne ab dem Startzeitpunkt `time` (Sekunden im AudioContext). */
const SYNTHS = {
  click: (time: number) => tone(time, "sine", 2000, 1200, 0.04, 0.25),
  hover: (time: number) => tone(time, "sine", 2800, 2500, 0.03, 0.05),
  /** Karte aufnehmen: heller Aufwärts-Blip. */
  select: (time: number) => {
    tone(time, "triangle", 880, 1320, 0.09, 0.2);
    tone(time, "sine", 1760, 2640, 0.09, 0.05);
  },
  /** Schiff oder Ziel einplanen: tiefer und voller als die Auswahl. */
  place: (time: number) => {
    tone(time, "triangle", 520, 780, 0.11, 0.26);
    tone(time, "sine", 1040, 1560, 0.11, 0.06);
  },
  cancel: (time: number) => tone(time, "triangle", 880, 520, 0.12, 0.2),
  /** Zug beenden: drei aufsteigende Töne, der letzte klingt am längsten. */
  confirm: (time: number) => {
    tone(time, "triangle", 660, 660, 0.18, 0.17);
    tone(time + 0.07, "triangle", 880, 880, 0.26, 0.17);
    tone(time + 0.14, "triangle", 1320, 1320, 0.34, 0.17);
  },
  /** Geht nicht, verpufft: zweimal ein tiefes Brummen. */
  denied: (time: number) => {
    tone(time, "square", 150, 140, 0.08, 0.08);
    tone(time + 0.11, "square", 150, 140, 0.11, 0.08);
  },
  /** Eine Karte fliegt auf die Hand. */
  draw: (time: number) => swish(time, 800, 4000, 0.2, 0.15),
  /** Neue Runde: ein weicher, anschwellender Akkord. */
  round: (time: number) => {
    tone(time, "sine", 220, 220, 1.2, 0.16, 0.25);
    tone(time, "sine", 330, 330, 1.2, 0.1, 0.3);
    tone(time + 0.1, "sine", 880, 880, 0.9, 0.04, 0.2);
  },
};

export type UiSound = keyof typeof SYNTHS;
export const UI_SOUNDS = Object.keys(SYNTHS) as UiSound[];

export function playUiSound(name: UiSound): void {
  if (isAudible()) SYNTHS[name](context.currentTime);
}

/** Klick für jeden Knopf und jede Auswahl in Dialogen (Schieberegler beim Loslassen), Ticken beim Überfahren einer Karte. */
export function installUiSounds(root: HTMLElement): void {
  root.addEventListener("click", (event) => {
    if ((event.target as Element).closest("button")) playUiSound("click");
  });
  root.addEventListener("change", () => playUiSound("click"));
  root.addEventListener("pointerover", (event) => {
    const card = (event.target as Element).closest(".card");
    if (card && !card.contains(event.relatedTarget as Node | null)) playUiSound("hover");
  });
}

/** Ein Ton, der in `duration` Sekunden von `from` nach `to` Hz gleitet und dabei verklingt. */
function tone(time: number, wave: OscillatorType, from: number, to: number, duration: number, volume: number, attack = 0.004): void {
  const oscillator = new OscillatorNode(context, { type: wave });
  oscillator.frequency.setValueAtTime(from, time);
  oscillator.frequency.exponentialRampToValueAtTime(to, time + duration);
  const gain = new GainNode(context, { gain: 0 });
  envelope(gain.gain, time, attack, volume, duration);
  oscillator.connect(gain).connect(output);
  oscillator.start(time);
  oscillator.stop(time + duration);
}

/** Rauschen durch einen Bandpass, der von `from` nach `to` Hz wandert. */
function swish(time: number, from: number, to: number, duration: number, volume: number): void {
  const source = new AudioBufferSourceNode(context, { buffer: noise });
  const filter = new BiquadFilterNode(context, { type: "bandpass", Q: 1.5 });
  filter.frequency.setValueAtTime(from, time);
  filter.frequency.exponentialRampToValueAtTime(to, time + duration);
  const gain = new GainNode(context, { gain: 0 });
  envelope(gain.gain, time, 0.03, volume, duration);
  source.connect(filter).connect(gain).connect(output);
  source.start(time);
  source.stop(time + duration);
}

/** Linear an in `attack`, dann exponentiell aus bis `duration`. */
function envelope(param: AudioParam, time: number, attack: number, peak: number, duration: number): void {
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, time + attack);
  param.exponentialRampToValueAtTime(0.0001, time + duration);
}
