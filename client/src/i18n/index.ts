// Übersetzungen: Die Sprache wird beim Start gewählt — `?lang=` hat Vorrang,
// sonst die erste unterstützte Browsersprache, sonst Englisch.

import type { Card } from "../../../shared/cards.ts";
import { de } from "./de.ts";
import { en, type CardText, type Messages } from "./en.ts";

const LOCALES = { en, de } satisfies Record<string, Messages>;

export type Locale = keyof typeof LOCALES;

function detectLocale(): Locale {
  const requested = [new URL(location.href).searchParams.get("lang"), ...navigator.languages];
  for (const tag of requested) {
    const language = tag?.split("-")[0]?.toLowerCase();
    if (language && language in LOCALES) return language as Locale;
  }
  return "en";
}

export const locale: Locale = detectLocale();
export const t: Messages = LOCALES[locale];

export function cardText(card: Card): CardText {
  return card.kind === "ship" ? t.ships[card.id] : t.commands[card.id];
}

export function upper(text: string): string {
  return text.toLocaleUpperCase(locale);
}
