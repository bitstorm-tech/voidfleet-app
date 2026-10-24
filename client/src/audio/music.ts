// Hintergrundmusik in zwei Stimmungen: ruhig, solange geplant wird, angespannt, während eine Runde abgespielt
// wird. Ein Wechsel blendet über, und jede Stimmung spielt dort weiter, wo sie zuletzt aufgehört hat. Beim
// ersten Mal erklingt ein Stück mit seinem Einklang; vor dem Ausklang blendet es in den Anfang seines
// Kernteils über, so läuft es ohne Lücke endlos. Abgespielt über `<audio>`, damit minutenlange Stücke nicht
// dekodiert im Speicher liegen; geladen werden sie beim Start (`loadMusic`).

import { MUSIC, type MusicMood } from "../data/sounds.ts";
import { context, musicBus, onUnlock } from "./mixer.ts";

/** Überblendung in Sekunden: beim Wechsel der Stimmung und am Ende des Kernteils. */
const MOOD_FADE = 2.5;
const LOOP_FADE = 4;

interface Voice {
  mood: MusicMood;
  element: HTMLAudioElement;
  gain: GainNode;
}

/** Blob-URL je Stimmung (`loadMusic`). */
const sources = new Map<MusicMood, string>();

let current: Voice | null = null;
let wanted: MusicMood | null = null;
let isUnlocked = false;
const resumeAt: Record<MusicMood, number> = { calm: 0, battle: 0 };

/**
 * Lädt die Stücke als Blob in den Speicher (komprimiert ein paar MB): Nur darin lässt sich zuverlässig springen, denn
 * Buns Server beantwortet keine Range-Anfragen, und ohne die setzt `<audio>` beim Springen auf den Anfang zurück.
 */
export function loadMusic(): Promise<void>[] {
  return (Object.keys(MUSIC) as MusicMood[]).map(async (mood) => {
    const response = await fetch(MUSIC[mood].file);
    sources.set(mood, URL.createObjectURL(await response.blob()));
  });
}

onUnlock(() => {
  isUnlocked = true;
  crossfade(wanted, MOOD_FADE);
});

/** Wechselt die Stimmung; `null` blendet die Musik aus. Bis der Browser Ton erlaubt, wird nur vorgemerkt. */
export function setMusicMood(mood: MusicMood | null): void {
  wanted = mood;
  if (isUnlocked && (current?.mood ?? null) !== mood) crossfade(mood, MOOD_FADE);
}

/** Blendet das laufende Stück aus und `mood` ab `from` ein, ohne Angabe dort, wo die Stimmung aufgehört hat. */
function crossfade(mood: MusicMood | null, fade: number, from = mood ? resumeAt[mood] : 0): void {
  if (current) {
    resumeAt[current.mood] = current.element.currentTime;
    fadeOut(current, fade);
  }
  current = mood && start(mood, from, fade);
}

function start(mood: MusicMood, from: number, fade: number): Voice {
  const [loopStart, loopEnd] = MUSIC[mood].loop;
  const element = new Audio(sources.get(mood));
  element.currentTime = from;
  const gain = new GainNode(context, { gain: 0 });
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(1, context.currentTime + fade);
  context.createMediaElementSource(element).connect(gain).connect(musicBus);
  const voice: Voice = { mood, element, gain };
  element.addEventListener("timeupdate", () => {
    if (current === voice && element.currentTime > loopEnd - LOOP_FADE) crossfade(mood, LOOP_FADE, loopStart);
  });
  void element.play();
  return voice;
}

function fadeOut({ element, gain }: Voice, fade: number): void {
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + fade);
  setTimeout(() => {
    element.pause();
    gain.disconnect();
  }, fade * 1000);
}
