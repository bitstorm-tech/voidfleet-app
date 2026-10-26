// Übersetzungen: Die Sprache wird beim Start gewählt — `?lang=` hat Vorrang,
// dann die in den Einstellungen gewählte, sonst die erste unterstützte
// Browsersprache, sonst Englisch. Ein Wechsel lädt die Seite neu.

import type { AdmiralId } from "../../../shared/admirals.ts";
import type { Card } from "../../../shared/cards.ts";
import { settings, updateSettings } from "../settings.ts";
import { de } from "./de.ts";
import { en, type CardText, type Messages } from "./en.ts";

const LOCALES = { en, de } satisfies Record<string, Messages>;

export type Locale = keyof typeof LOCALES;

export const LOCALE_NAMES = Object.fromEntries(Object.entries(LOCALES).map(([key, messages]) => [key, messages.languageName])) as Record<
  Locale,
  string
>;

function detectLocale(): Locale {
  const requested = [new URL(location.href).searchParams.get("lang"), settings.language, ...navigator.languages];
  for (const tag of requested) {
    const language = tag?.split("-")[0]?.toLowerCase();
    if (language && language in LOCALES) return language as Locale;
  }
  return "en";
}

export const locale: Locale = detectLocale();
export const t: Messages = LOCALES[locale];

/** Speichert die Sprache und lädt die Seite ohne `?lang=` neu, damit sie gilt. */
export function switchLocale(next: Locale): void {
  updateSettings({ language: next });
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  location.replace(url);
}

export function cardText(card: Card): CardText {
  return card.kind === "ship" ? t.ships[card.id] : t.commands[card.id];
}

/** Name und Beiname, etwa „Admiral Osei – Die Mauer“. */
export function admiralTitle(admiral: AdmiralId): string {
  const { name, epithet } = t.admirals[admiral];
  return t.admiralTitle(name, epithet);
}

export function upper(text: string): string {
  return text.toLocaleUpperCase(locale);
}
