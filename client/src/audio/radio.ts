// Bordfunk: kurze Funksprüche der eigenen Flotte zu den Momenten, auf die es ankommt — Torpedo im Anflug,
// Abschuss, Overdrive, Sieg. Die Aufnahmen sind englisch (`data/radio.ts`); den Untertitel in der Sprache des
// Spielers zeigt `ui/radioSubtitle.ts`, angemeldet über `onTransmission`. Es spricht immer nur einer: Ein Spruch,
// der bei belegtem Funk ankommt, wartet kurz, wenn er wichtiger ist als der, der schon wartet; sonst entfällt er.
// Derselbe Spruch wiederholt sich erst nach einer Weile, je unwichtiger, desto später.
// Gesendet wird über eine Funkstrecke — Bandpass, Präsenz und etwas Sättigung, dazu Rauschen, ein Piepen beim
// Drücken und ein Rauschstoß beim Loslassen der Sprechtaste — auf den Bus `voiceBus`; die Musik weicht solange
// zurück. Mit Lautstärke 0 schweigt der Bordfunk samt Untertitel, ebenso solange Animationen übersprungen werden.

import { RADIO, type RadioCue } from "../data/radio.ts";
import { animationsSkipped } from "../scene/tween.ts";
import { settings } from "../settings.ts";
import { context, duckMusic, isAudible, voiceBus } from "./mixer.ts";
import { loadSample, pickVariant, type Sample } from "./sounds.ts";

/** Ein gesendeter Spruch für den Untertitel; `duration` in Sekunden, Sprechtaste eingeschlossen. */
export interface Transmission {
  cue: RadioCue;
  variant: number;
  duration: number;
}

/** So lange (Sekunden) darf ein Spruch auf den freien Funk warten, und die Pause zwischen zwei Sprüchen. */
const MAX_WAIT = 2;
const GAP = 0.3;
/** Frühestens nach so vielen Sekunden derselbe Spruch noch einmal, je Priorität. */
const REPEAT_AFTER = { 1: 60, 2: 15, 3: 0 };
/** Vom Drücken der Sprechtaste bis zur Stimme und von ihrem Ende bis zum Loslassen. */
const KEY_UP = 0.12;
const TAIL = 0.18;
const VOICE_LEVEL = 0.7;
const HISS_LEVEL = 0.012;

// Die Funkstrecke: Alles, was gesendet wird, klingt wie über ein Funkgerät.
const transmitter = new BiquadFilterNode(context, { type: "highpass", frequency: 320, Q: 0.7 });
transmitter
  .connect(new BiquadFilterNode(context, { type: "lowpass", frequency: 3600, Q: 0.7 }))
  .connect(new BiquadFilterNode(context, { type: "peaking", frequency: 2000, Q: 0.9, gain: 5 }))
  .connect(new WaveShaperNode(context, { curve: saturation(1.6), oversample: "2x" }))
  .connect(voiceBus);

const hiss = new AudioBuffer({ length: context.sampleRate * 2, sampleRate: context.sampleRate });
hiss.getChannelData(0).forEach((_, index, data) => (data[index] = Math.random() * 2 - 1));

const samples = new Map<RadioCue, Sample[]>();
const lastVariant = new Map<RadioCue, number>();
const lastSaid = new Map<RadioCue, number>();
const listeners = new Set<(transmission: Transmission | null) => void>();
/** Der laufende Spruch, solange der Funk belegt ist. */
let current: { stop: () => void } | null = null;
let waiting: { cue: RadioCue; variant: number | undefined; priority: number; since: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Lädt alle Funksprüche; im Spiel über `preload.ts`, die Vorschau-Seite ruft es selbst auf. */
export function loadRadio(): Promise<void>[] {
  return (Object.keys(RADIO) as RadioCue[]).map(async (cue) => {
    samples.set(cue, await Promise.all(RADIO[cue].files.map(loadSample)));
  });
}

/** Meldet jeden Spruch, sobald er gesendet wird, und `null`, wenn der Funk abbricht. */
export function onTransmission(listener: (transmission: Transmission | null) => void): void {
  listeners.add(listener);
}

/**
 * Ein Funkspruch, sobald der Funk frei ist (siehe oben). `variant` wählt eine bestimmte Aufnahme und übergeht die
 * Sperre gegen Wiederholungen (Vorschau-Seite).
 */
export function say(cue: RadioCue, variant?: number): void {
  if (!samples.has(cue) || settings.voiceVolume === 0 || !isAudible() || animationsSkipped()) return;
  const { priority } = RADIO[cue];
  const now = context.currentTime;
  if (variant === undefined && now - (lastSaid.get(cue) ?? -Infinity) < REPEAT_AFTER[priority]) return;
  if (current === null) return transmit(cue, variant);
  if (waiting === null || priority > waiting.priority) waiting = { cue, variant, priority, since: now };
}

/** Bricht den laufenden Spruch ab und verwirft den wartenden, etwa wenn die Runde übersprungen wird. */
export function silenceRadio(): void {
  waiting = null;
  if (current === null) return;
  clearTimeout(timer);
  current.stop();
  current = null;
  duckMusic(false);
  for (const listener of listeners) listener(null);
}

function transmit(cue: RadioCue, variant = pickVariant(lastVariant, cue, RADIO[cue].files.length)): void {
  const sample = samples.get(cue)![variant]!;
  const start = context.currentTime + 0.02;
  const voiceAt = start + KEY_UP;
  const end = voiceAt + sample.buffer.duration - sample.onset;
  const line = new GainNode(context);
  line.connect(transmitter);

  const voice = new AudioBufferSourceNode(context, { buffer: sample.buffer });
  voice.connect(new GainNode(context, { gain: sample.gain * VOICE_LEVEL })).connect(line);
  voice.start(voiceAt, sample.onset);

  // Rauschstoß beim Drücken, leises Rauschen unter der Stimme, Rauschstoß beim Loslassen.
  const noise = new AudioBufferSourceNode(context, { buffer: hiss, loop: true });
  const noiseGain = new GainNode(context, { gain: 0 });
  noiseGain.gain.setValueAtTime(0.25, start);
  noiseGain.gain.exponentialRampToValueAtTime(HISS_LEVEL, start + 0.07);
  noiseGain.gain.setValueAtTime(HISS_LEVEL, end);
  noiseGain.gain.linearRampToValueAtTime(0.22, end + 0.02);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, end + TAIL);
  noise.connect(noiseGain).connect(line);
  noise.start(start);
  noise.stop(end + TAIL);

  // Piepen der Sprechtaste.
  const beep = new OscillatorNode(context, { frequency: 1500 });
  const beepGain = new GainNode(context, { gain: 0 });
  beepGain.gain.setValueAtTime(0, start + 0.03);
  beepGain.gain.linearRampToValueAtTime(0.12, start + 0.035);
  beepGain.gain.setValueAtTime(0.12, start + 0.085);
  beepGain.gain.linearRampToValueAtTime(0, start + 0.09);
  beep.connect(beepGain).connect(line);
  beep.start(start);
  beep.stop(start + 0.1);

  current = {
    stop: () => {
      const now = context.currentTime;
      line.gain.setTargetAtTime(0, now, 0.02);
      for (const source of [voice, noise, beep]) source.stop(now + 0.1);
    },
  };
  lastSaid.set(cue, start);
  duckMusic(true);
  const duration = end + TAIL - start;
  for (const listener of listeners) listener({ cue, variant, duration });
  timer = setTimeout(next, (duration + GAP) * 1000);
}

/** Der Funk ist frei: Ein wartender Spruch kommt dran, solange er noch zum Geschehen passt. */
function next(): void {
  current = null;
  const queued = waiting;
  waiting = null;
  const fresh = queued !== null && context.currentTime - queued.since <= MAX_WAIT;
  if (fresh && settings.voiceVolume > 0 && isAudible() && !animationsSkipped()) transmit(queued.cue, queued.variant);
  else duckMusic(false);
}

/** Sanfte Sättigung (tanh, auf ±1 normiert): verdichtet die Stimme wie ein leicht übersteuertes Funkgerät. */
function saturation(drive: number): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: 1024 }, (_, index) => Math.tanh(drive * (index / 511.5 - 1)) / Math.tanh(drive));
}
