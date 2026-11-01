// Einstellungen: Zahnrad-Knopf oben rechts neben dem Ansichts-Knopf öffnet einen modalen Dialog im Stil eines
// Steuerpults mit zwei eingelassenen Feldern: links die Regler für die Lautstärke von Musik, Effekten und Bordfunk,
// die Sprache und, solange der Browser es anbietet, das Installieren als eigene App (`install.ts`); rechts je eine
// Geschwindigkeitswahl für Angriffe, Schiffsbewegungen und die übrigen Animationen und der Mauszeiger. Jede Auswahl
// wird gespeichert (`settings.ts`); Lautstärken, Geschwindigkeiten und Cursor gelten sofort, ein Sprachwechsel lädt
// die Seite neu.

import { LOCALE_NAMES, locale, switchLocale, t } from "../i18n/index.ts";
import { settings, updateSettings } from "../settings.ts";
import { CURSORS, type CursorId } from "./cursor.ts";
import { iconDialog } from "./iconDialog.ts";
import { installApp, onInstallable } from "./install.ts";

type VolumeSetting = "musicVolume" | "effectsVolume" | "voiceVolume";
type SpeedSetting = "attackSpeed" | "movementSpeed" | "animationSpeed";

const ICON = `<circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />`;

export class SettingsDialog {
  private readonly dialog: HTMLDialogElement;

  constructor(container: HTMLElement) {
    const dialog = (this.dialog = iconDialog(container, "settings", t.settings.title, ICON));
    dialog
      .querySelector(".dialog-close")!
      .before(
        consolePanel(
          volumeSlider("musicVolume"),
          volumeSlider("effectsVolume"),
          volumeSlider("voiceVolume"),
          choice("language", t.settings.language, LOCALE_NAMES, locale, switchLocale),
          installRow(),
        ),
        consolePanel(speedChoice("attackSpeed"), speedChoice("movementSpeed"), speedChoice("animationSpeed"), cursorChoice()),
      );
  }

  open(): void {
    this.dialog.showModal();
  }
}

/** Eingelassenes Feld im Pult, das eine Gruppe von Reglern trägt. */
function consolePanel(...controls: HTMLElement[]): HTMLDivElement {
  const panel = Object.assign(document.createElement("div"), { className: "console-panel" });
  panel.append(...controls);
  return panel;
}

/** Schieberegler mit leuchtender Füllung (`--fill`) und der Lautstärke in Prozent als Anzeige daneben. */
function volumeSlider(setting: VolumeSetting): HTMLLabelElement {
  const label = Object.assign(document.createElement("label"), { className: "settings-volume" });
  const input = Object.assign(document.createElement("input"), { type: "range", min: "0", max: "1", step: "0.05", value: String(settings[setting]) });
  const readout = document.createElement("output");
  const show = () => {
    const percent = Math.round(Number(input.value) * 100);
    readout.textContent = String(percent);
    input.style.setProperty("--fill", `${percent}%`);
  };
  show();
  input.addEventListener("input", () => {
    show();
    updateSettings({ [setting]: Number(input.value) });
  });
  label.append(Object.assign(document.createElement("span"), { textContent: t.settings[setting] }), readout, input);
  return label;
}

function speedChoice(setting: SpeedSetting): HTMLFieldSetElement {
  return choice(setting, t.settings[setting], t.settings.speeds, settings[setting], (next) => updateSettings({ [setting]: next }));
}

/** Mauszeiger als Raster aus Vorschaubildern; die Legende nennt den gewählten. */
function cursorChoice(): HTMLFieldSetElement {
  const fieldset = Object.assign(document.createElement("fieldset"), { className: "settings-cursor" });
  const legend = document.createElement("legend");
  const showName = () => (legend.textContent = `${t.settings.cursor}: ${t.settings.cursors[settings.cursor]}`);
  showName();
  fieldset.append(legend);
  for (const [id, cursor] of Object.entries(CURSORS) as [CursorId, (typeof CURSORS)[CursorId]][]) {
    const label = Object.assign(document.createElement("label"), { title: t.settings.cursors[id] });
    const input = Object.assign(document.createElement("input"), { type: "radio", name: "cursor", value: id, checked: id === settings.cursor });
    input.addEventListener("change", () => {
      updateSettings({ cursor: id });
      showName();
    });
    label.append(input, Object.assign(document.createElement("img"), { src: cursor.url, alt: t.settings.cursors[id] }));
    fieldset.append(label);
  }
  return fieldset;
}

/** „Als App installieren“, nur solange der Browser die Installation anbietet. */
function installRow(): HTMLDivElement {
  const row = Object.assign(document.createElement("div"), { className: "settings-install" });
  const button = Object.assign(document.createElement("button"), { type: "button", textContent: t.settings.installButton });
  button.addEventListener("click", installApp);
  row.append(Object.assign(document.createElement("span"), { textContent: t.settings.install }), button);
  onInstallable((installable) => (row.hidden = !installable));
  return row;
}

/** Segmentierte Auswahl: ein Feld je Option, die gewählte hervorgehoben. */
function choice<T extends string>(name: string, legend: string, labels: Record<T, string>, current: T, onChange: (next: T) => void): HTMLFieldSetElement {
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
