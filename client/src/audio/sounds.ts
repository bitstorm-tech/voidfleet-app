// Soundeffekte aus `data/sounds.ts`. Alle Dateien werden beim Start geladen (`loadSounds`) und auf gleiche
// Lautheit gebracht; der stille Vorlauf wird übersprungen, damit der Ton genau mit dem Bild einsetzt. Jedes
// Abspielen wählt eine zufällige Variante (nie zweimal dieselbe hintereinander) und verstimmt sie leicht; die
// Stereoposition folgt dem Geschehen auf dem Brett (eigene Seite links, Gegner rechts). Solange Animationen
// übersprungen werden, der Ton nicht freigegeben oder stumm geschaltet ist, bleibt es still. Der Bordfunk lädt
// seine Aufnahmen ebenso (`loadSample`), spielt sie aber selbst ab (`radio.ts`).

import { SOUNDS, type SoundId } from "../data/sounds.ts";
import { animationsSkipped } from "../scene/tween.ts";
import { context, effectsBus, isAudible } from "./mixer.ts";

/** Ab diesem Welt-x liegt ein Sound ganz außen im Stereobild (etwa der Bildrand auf Brett-Höhe); ganz hart schwenkt nichts. */
const PAN_WIDTH = 9;
const MAX_PAN = 0.8;
/** Zufällige Verstimmung als Anteil der Abspielrate, damit wiederholte Samples nicht mechanisch klingen. */
const DETUNE = 0.06;
/** Gleichzeitige Stimmen je Sound: Eine Salve mit acht Einschlägen wäre sonst nur laut. */
const MAX_VOICES = 4;
/** Ziel der Normalisierung: Effektivwert der lautesten 50 ms. */
const TARGET_LOUDNESS = 0.25;
const LOUDNESS_WINDOW = 0.05;
/** Ab diesem Pegel beginnt der Sound; ein paar Millisekunden davor setzt das Abspielen ein. */
const ONSET_LEVEL = 0.01;
const ONSET_MARGIN = 0.005;
/** Sekunden: Schleifen setzen sanft ein, `stop` blendet aus. */
const LOOP_FADE_IN = 0.15;
const STOP_FADE = 0.12;

export interface PlayOptions {
  /** Welt-x des Geschehens. */
  x?: number;
  /** Faktor auf die Lautstärke des Sounds. */
  volume?: number;
  /** Abspielrate: unter 1 tiefer und länger, darüber höher und kürzer. */
  rate?: number;
  /** Diese Variante statt einer zufälligen (Vorschau-Seite). */
  variant?: number;
}

export interface SoundHandle {
  /** Schwenkt den Sound sanft an die Stelle (Welt-x). */
  follow(x: number): void;
  /** Blendet in `fade` Sekunden aus und beendet den Sound. */
  stop(fade?: number): void;
}

export interface Sample {
  buffer: AudioBuffer;
  /** Verstärkung auf die gemeinsame Lautheit. */
  gain: number;
  /** Stiller Vorlauf in Sekunden. */
  onset: number;
}

const SILENT: SoundHandle = { follow() {}, stop() {} };
const samples = new Map<SoundId, Sample[]>();
const lastVariant = new Map<SoundId, number>();
const voices = new Map<SoundId, Set<SoundHandle>>();
let isMuted = false;

/** Lädt und dekodiert alle Effekte; im Spiel über `preload.ts`, Dev-Seiten rufen es selbst auf. */
export function loadSounds(): Promise<void>[] {
  return (Object.keys(SOUNDS) as SoundId[]).map(async (id) => {
    samples.set(id, await Promise.all(SOUNDS[id].files.map(loadSample)));
  });
}

/** Schaltet die Effekte stumm, etwa für die Generalprobe hinter dem Ladebildschirm. */
export function muteSounds(muted: boolean): void {
  isMuted = muted;
}

export function playSound(id: SoundId, options: PlayOptions = {}): SoundHandle {
  return start(id, options, false);
}

/** Spielt den Sound in Schleife, bis `stop` ihn ausblendet. */
export function loopSound(id: SoundId, options: PlayOptions = {}): SoundHandle {
  return start(id, options, true);
}

/** Blendet alle laufenden Effekte aus, etwa wenn der Spieler die Runde überspringt. */
export function stopSounds(): void {
  for (const active of voices.values()) for (const voice of active) voice.stop();
}

function start(id: SoundId, options: PlayOptions, loop: boolean): SoundHandle {
  const variants = samples.get(id);
  const active = voices.get(id) ?? new Set<SoundHandle>();
  if (!variants || isMuted || !isAudible() || animationsSkipped() || active.size >= MAX_VOICES) return SILENT;
  const { buffer, gain, onset } = variants[options.variant ?? pickVariant(lastVariant, id, variants.length)]!;
  const now = context.currentTime;
  const level = gain * SOUNDS[id].volume * (options.volume ?? 1);
  const playbackRate = (options.rate ?? 1) * (1 + (Math.random() - 0.5) * DETUNE);
  const source = new AudioBufferSourceNode(context, { buffer, loop, playbackRate });
  const volume = new GainNode(context, { gain: level });
  const panner = new StereoPannerNode(context, { pan: panAt(options.x ?? 0) });
  if (loop) {
    volume.gain.setValueAtTime(0, now);
    volume.gain.linearRampToValueAtTime(level, now + LOOP_FADE_IN);
  }
  source.connect(volume).connect(panner).connect(effectsBus);
  source.start(now, onset);

  let isStopped = false;
  const voice: SoundHandle = {
    follow: (x) => panner.pan.setTargetAtTime(panAt(x), context.currentTime, 0.05),
    stop: (fade = STOP_FADE) => {
      if (isStopped) return;
      isStopped = true;
      const at = context.currentTime;
      volume.gain.cancelScheduledValues(at);
      volume.gain.setValueAtTime(volume.gain.value, at);
      volume.gain.linearRampToValueAtTime(0, at + fade);
      source.stop(at + fade);
    },
  };
  active.add(voice);
  voices.set(id, active);
  source.addEventListener("ended", () => active.delete(voice));
  return voice;
}

/** Zufällig eine Variante, aber nie zweimal dieselbe hintereinander; `last` merkt sich die letzte je Id. */
export function pickVariant<Id>(last: Map<Id, number>, id: Id, count: number): number {
  const choices = [...Array(count).keys()].filter((index) => count === 1 || index !== last.get(id));
  const index = choices[Math.floor(Math.random() * choices.length)]!;
  last.set(id, index);
  return index;
}

function panAt(x: number): number {
  return Math.min(Math.max(x / PAN_WIDTH, -MAX_PAN), MAX_PAN);
}

/** Lädt und dekodiert eine Datei samt Verstärkung auf die gemeinsame Lautheit und stillem Vorlauf. */
export async function loadSample(url: string): Promise<Sample> {
  const response = await fetch(url);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  return { buffer, ...analyse(buffer) };
}

/** Verstärkung auf `TARGET_LOUDNESS` (ohne dass die Spitze übersteuert) und Länge des stillen Vorlaufs. */
function analyse(buffer: AudioBuffer): Omit<Sample, "buffer"> {
  const { length, numberOfChannels, sampleRate } = buffer;
  // Je Abtastwert über alle Kanäle: Leistung für den Effektivwert, Betrag für Spitze und Vorlauf.
  const power = new Float64Array(length);
  const level = new Float32Array(length);
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      power[i] = power[i]! + data[i]! ** 2 / numberOfChannels;
      level[i] = Math.max(level[i]!, Math.abs(data[i]!));
    }
  }
  const window = Math.max(Math.min(Math.round(LOUDNESS_WINDOW * sampleRate), length), 1);
  let sum = 0;
  let loudest = 0;
  for (let i = 0; i < length; i++) {
    sum += power[i]! - (i >= window ? power[i - window]! : 0);
    loudest = Math.max(loudest, sum);
  }
  const peak = level.reduce((max, value) => Math.max(max, value), 0);
  const rms = Math.sqrt(loudest / window);
  const first = Math.max(level.findIndex((value) => value > ONSET_LEVEL), 0);
  return {
    gain: rms > 0 ? Math.min(TARGET_LOUDNESS / rms, 1 / peak) : 0,
    onset: Math.max(first / sampleRate - ONSET_MARGIN, 0),
  };
}
