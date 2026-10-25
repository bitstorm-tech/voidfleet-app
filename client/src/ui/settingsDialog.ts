// Einstellungen: Zahnrad-Knopf oben rechts neben dem Vollbild-Knopf öffnet einen modalen Dialog
// mit Reglern für die Lautstärke von Musik, Effekten und Bordfunk, je einer Geschwindigkeitswahl für Angriffe,
// Schiffsbewegungen und die übrigen Animationen sowie der Sprache. Jede Auswahl wird gespeichert
// (`settings.ts`); Lautstärken und Geschwindigkeiten gelten sofort, ein Sprachwechsel lädt die Seite neu.

import { locale, LOCALE_NAMES, switchLocale, t } from "../i18n/index.ts";
import { settings, updateSettings } from "../settings.ts";
import { iconDialog } from "./iconDialog.ts";

type VolumeSetting = "musicVolume" | "effectsVolume" | "voiceVolume";
type SpeedSetting = "attackSpeed" | "movementSpeed" | "animationSpeed";

const ICON = `<circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />`;

export class SettingsDialog {
  constructor(container: HTMLElement) {
    const dialog = iconDialog(container, "settings", t.settings.title, ICON);
    dialog.querySelector(".dialog-close")!.before(
      volumeSlider("musicVolume"),
      volumeSlider("effectsVolume"),
      volumeSlider("voiceVolume"),
      speedChoice("attackSpeed"),
      speedChoice("movementSpeed"),
      speedChoice("animationSpeed"),
      choice("language", t.settings.language, LOCALE_NAMES, locale, switchLocale),
    );
  }
}

function volumeSlider(setting: VolumeSetting): HTMLLabelElement {
  const label = Object.assign(document.createElement("label"), { className: "settings-volume" });
  const input = Object.assign(document.createElement("input"), { type: "range", min: "0", max: "1", step: "0.05", value: String(settings[setting]) });
  input.addEventListener("input", () => updateSettings({ [setting]: Number(input.value) }));
  label.append(Object.assign(document.createElement("span"), { textContent: t.settings[setting] }), input);
  return label;
}

function speedChoice(setting: SpeedSetting): HTMLFieldSetElement {
  return choice(setting, t.settings[setting], t.settings.speeds, settings[setting], (next) => updateSettings({ [setting]: next }));
}

/** Segmentierte Auswahl: ein Feld je Option, die gewählte hervorgehoben. */
function choice<T extends string>(
  name: string,
  legend: string,
  labels: Record<T, string>,
  current: T,
  onChange: (next: T) => void,
): HTMLFieldSetElement {
  const fieldset = Object.assign(document.createElement("fieldset"), { className: "settings-choice" });
  fieldset.append(Object.assign(document.createElement("legend"), { textContent: legend }));
  for (const option of Object.keys(labels) as T[]) {
    const label = document.createElement("label");
    const input = Object.assign(document.createElement("input"), { type: "radio", name, value: option, checked: option === current });
    input.addEventListener("change", () => onChange(option));
    label.append(input, Object.assign(document.createElement("span"), { textContent: labels[option] }));
    fieldset.append(label);
  }
  return fieldset;
}
