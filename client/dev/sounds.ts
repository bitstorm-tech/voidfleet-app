// Vorschau aller Klänge ohne Server (`BUN_PORT=4173 bun dev/sounds.html`): die Lautstärkeregler wie im Spiel,
// die Musik in beiden Stimmungen, die synthetisierten Klänge der Oberfläche, jede Variante jedes
// Soundeffekts einzeln, so wie das Spiel sie abspielt (gleiche Lautheit, Lautstärke und Verstimmung), und jede
// Aufnahme des Bordfunks über die Funkstrecke (der gesprochene Text steht im Tooltip).
// Neben jeder Datei stehen Dauer, Spitze, Lautheit (lauteste 50 ms), stiller Vorlauf und der Pegel der
// ersten und letzten Sekunde, damit Ausreißer auffallen; bei der Musik zusätzlich der Kernteil ohne Ein- und
// Ausklang, der als `loop` in `data/sounds.ts` gehört. `window.soundStats` enthält dieselben Werte.

import { context } from "../src/audio/mixer.ts";
import { loadMusic, setMusicMood } from "../src/audio/music.ts";
import { loadRadio, say, silenceRadio } from "../src/audio/radio.ts";
import { loadSounds, loopSound, playSound } from "../src/audio/sounds.ts";
import { playUiSound, UI_SOUNDS } from "../src/audio/uiSounds.ts";
import { RADIO, type RadioCue } from "../src/data/radio.ts";
import { MUSIC, SOUNDS, type MusicMood, type SoundId } from "../src/data/sounds.ts";
import { en } from "../src/i18n/en.ts";
import { settings, updateSettings } from "../src/settings.ts";

interface Stats {
  duration: number;
  /** Pegel in dBFS. */
  peak: number;
  loudness: number;
  head: number;
  tail: number;
  /** Sekunden bis zum ersten hörbaren Abtastwert. */
  onset: number;
  /** Erste und letzte Sekunde, die höchstens 3 dB unter dem mittleren Pegel liegt. */
  core: [number, number];
}

declare global {
  interface Window {
    soundStats: Record<string, Stats>;
  }
}

/** Schleifen spielen in der Vorschau so lange und blenden dann aus. */
const LOOPS: readonly SoundId[] = ["engine_light", "engine_medium", "engine_heavy"];
const LOOP_PREVIEW = 4000;

const root = document.getElementById("sounds")!;
window.soundStats = {};
await Promise.all([...loadSounds(), ...loadMusic(), ...loadRadio()]);

heading("Lautstärke");
for (const [setting, label] of [["musicVolume", "Musik"], ["effectsVolume", "Effekte"], ["voiceVolume", "Bordfunk"]] as const) {
  const input = Object.assign(document.createElement("input"), { type: "range", min: "0", max: "1", step: "0.05", value: String(settings[setting]) });
  input.addEventListener("input", () => updateSettings({ [setting]: Number(input.value) }));
  row(label, [input]);
}

heading("Musik");
row("Stimmung", [
  ...(Object.keys(MUSIC) as MusicMood[]).map((mood) => button(mood, () => setMusicMood(mood))),
  button("aus", () => setMusicMood(null)),
]);
for (const [mood, { file }] of Object.entries(MUSIC)) row(mood, [], file, `music/${mood}`);

heading("Oberfläche (synthetisiert)");
row("", UI_SOUNDS.map((name) => button(name, () => playUiSound(name))));

heading("Effekte");
for (const id of Object.keys(SOUNDS) as SoundId[]) {
  const { files } = SOUNDS[id];
  const play = (variant?: number) => () => {
    if (!LOOPS.includes(id)) return void playSound(id, { variant });
    const loop = loopSound(id, { variant });
    setTimeout(() => loop.stop(0.5), LOOP_PREVIEW);
  };
  row(id, [button("Zufall", play()), ...files.map((_, variant) => button(String(variant + 1), play(variant)))]);
  files.forEach((url, variant) => row("", [], url, `${id}_${variant + 1}`));
}

heading("Bordfunk");
for (const cue of Object.keys(RADIO) as RadioCue[]) {
  const { files } = RADIO[cue];
  const lines = en.radio.lines[cue];
  const buttons = files.map((_, variant) => {
    const element = button(String(variant + 1), () => {
      silenceRadio();
      say(cue, variant);
    });
    element.title = lines[variant]!;
    return element;
  });
  row(cue, buttons);
  files.forEach((url, variant) => row("", [], url, `${cue}_${variant + 1}`));
}

function heading(text: string): void {
  root.append(Object.assign(document.createElement("h2"), { textContent: text }));
}

/** Zeile mit Beschriftung und Knöpfen; mit `url` stehen rechts die Messwerte der Datei. */
function row(label: string, controls: HTMLElement[], url?: string, name?: string): void {
  const buttons = Object.assign(document.createElement("div"), { className: "buttons" });
  buttons.append(...controls);
  const stats = Object.assign(document.createElement("div"), { className: "stats", textContent: name ?? "" });
  const element = Object.assign(document.createElement("div"), { className: "row" });
  element.append(Object.assign(document.createElement("strong"), { textContent: label }), buttons, stats);
  root.append(element);
  if (url && name) {
    void measure(url).then((measured) => {
      window.soundStats[name] = measured;
      stats.textContent = `${name.padEnd(20)}${describe(measured)}`;
    });
  }
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const element = Object.assign(document.createElement("button"), { type: "button", textContent: text });
  element.addEventListener("click", onClick);
  return element;
}

function describe({ duration, peak, loudness, head, tail, onset, core }: Stats): string {
  const db = (value: number) => `${value.toFixed(1)} dB`.padStart(9);
  const stats = `${duration.toFixed(2)} s   Spitze${db(peak)}   Lautheit${db(loudness)}   Anfang${db(head)}   Ende${db(tail)}   Vorlauf ${Math.round(onset * 1000)} ms`;
  return duration > 30 ? `${stats}   Kernteil ${core[0]}–${core[1]} s` : stats;
}

async function measure(url: string): Promise<Stats> {
  const buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const { length, sampleRate } = buffer;
  const level = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    buffer.getChannelData(channel).forEach((value, index) => (level[index] = Math.max(level[index]!, Math.abs(value))));
  }
  const rms = (from: number, to: number) => {
    let sum = 0;
    for (let index = from; index < to; index++) sum += level[index]! ** 2;
    return Math.sqrt(sum / Math.max(to - from, 1));
  };
  const window = Math.round(sampleRate * 0.05);
  let loudest = 0;
  for (let start = 0; start + window <= length; start += Math.ceil(window / 2)) loudest = Math.max(loudest, rms(start, start + window));
  const second = Math.min(sampleRate, length);
  const db = (value: number) => 20 * Math.log10(Math.max(value, 1e-6));
  const seconds = Array.from({ length: Math.floor(length / sampleRate) }, (_, index) => db(rms(index * sampleRate, (index + 1) * sampleRate)));
  const threshold = ([...seconds].sort((a, b) => a - b)[Math.floor(seconds.length / 2)] ?? 0) - 3;
  return {
    duration: buffer.duration,
    peak: db(level.reduce((max, value) => Math.max(max, value), 0)),
    loudness: db(loudest),
    head: db(rms(0, second)),
    tail: db(rms(length - second, length)),
    onset: Math.max(level.findIndex((value) => value > 0.01), 0) / sampleRate,
    core: [seconds.findIndex((value) => value >= threshold), seconds.findLastIndex((value) => value >= threshold) + 1],
  };
}
