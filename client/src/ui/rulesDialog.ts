// Spielregeln: Fragezeichen-Knopf links neben dem Zahnrad öffnet einen großen modalen
// Dialog mit Kapitelnavigation links und dem Regeltext rechts. Die Texte kommen aus
// `t.rules.sections`; jedes Kapitel bekommt hier seine Illustration (`rulesFigures.ts`),
// Screenshots aus `assets/images/rules/`, die Admirale mit Flaggschiff und Fähigkeitskarte oder die Galerie
// aller Karten samt Flaggschiffen und Tokens (`cardView.ts`).

import { ADMIRAL_IDS, ADMIRALS } from "../../../shared/admirals.ts";
import { type Card, COMMAND_ORDER, COMMANDS, type CommandType, deckCopies, FLAGSHIPS, isToken, SHIPS, shipById, TOKENS } from "../../../shared/cards.ts";
import deployScreenshot from "../../assets/images/rules/deploy.jpg";
import maneuverScreenshot from "../../assets/images/rules/maneuver.jpg";
import { admiralPortrait, flagshipAdmiral } from "../data/admirals.ts";
import type { Messages, RulesSection } from "../i18n/en.ts";
import { admiralTitle, cardText, t } from "../i18n/index.ts";
import { createCard } from "./cardView.ts";
import { iconDialog } from "./iconDialog.ts";
import { createPowerCard } from "./powerCard.ts";
import { boardFigure, fireOrdersFigure, overdriveFigure, phasesFigure, turnFigure } from "./rulesFigures.ts";

type SectionId = keyof Messages["rules"]["sections"];

const ICON = `<circle cx="12" cy="12" r="10" />
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
  <line x1="12" y1="17" x2="12.01" y2="17" />`;

/** Kapitel in Lesereihenfolge; die Illustration steht nach dem Absatz `after` (Standard: nach dem letzten). */
const CHAPTERS: readonly { id: SectionId; figures?: (() => Element)[]; after?: number }[] = [
  { id: "goal", figures: [overdriveFigure] },
  { id: "turn", figures: [turnFigure, () => screenshot(deployScreenshot)], after: 2 },
  { id: "admirals" },
  { id: "roster", figures: [admiralGallery] },
  { id: "board", figures: [boardFigure], after: 2 },
  { id: "movement", figures: [() => screenshot(maneuverScreenshot)], after: 1 },
  { id: "resolution", figures: [phasesFigure] },
  { id: "combat", figures: [fireOrdersFigure], after: 2 },
  { id: "ships", figures: [shipGallery], after: 1 },
  { id: "commands", figures: [commandGallery] },
  { id: "hand" },
  { id: "controls" },
];

export class RulesDialog {
  constructor(container: HTMLElement) {
    const dialog = iconDialog(container, "rules", t.rules.title, ICON);
    const layout = Object.assign(document.createElement("div"), { className: "rules-layout" });
    const nav = Object.assign(document.createElement("nav"), { className: "rules-nav" });
    const body = Object.assign(document.createElement("div"), { className: "rules-body" });
    const sections = CHAPTERS.map((chapter) => {
      const section = buildSection(chapter);
      const link = Object.assign(document.createElement("button"), { type: "button", textContent: t.rules.sections[chapter.id].heading });
      link.addEventListener("click", () => section.scrollIntoView({ block: "start", behavior: "smooth" }));
      nav.append(link);
      body.append(section);
      return { section, link };
    });
    // Das Kapitel, das oben im sichtbaren Bereich steht, ist in der Navigation markiert.
    const markActive = () => {
      const top = body.getBoundingClientRect().top + 40;
      const active = sections.findLast(({ section }) => section.getBoundingClientRect().top <= top) ?? sections[0]!;
      for (const { link } of sections) link.classList.toggle("active", link === active.link);
    };
    body.addEventListener("scroll", markActive, { passive: true });
    sections[0]!.link.classList.add("active");
    layout.append(nav, body);
    dialog.querySelector(".dialog-close")!.before(layout);
  }
}

function buildSection({ id, figures = [], after }: (typeof CHAPTERS)[number]): HTMLElement {
  const { heading, paragraphs, caption }: RulesSection = t.rules.sections[id];
  const section = Object.assign(document.createElement("section"), { className: "rules-section" });
  section.append(Object.assign(document.createElement("h3"), { textContent: heading }));
  const figureAt = after ?? paragraphs.length;
  paragraphs.forEach((text, index) => {
    if (index === figureAt) section.append(...buildFigures(figures, caption));
    section.append(Object.assign(document.createElement("p"), { textContent: text }));
  });
  if (figureAt >= paragraphs.length) section.append(...buildFigures(figures, caption));
  return section;
}

/** Jede Illustration in einer `<figure>`; die Bildunterschrift steht unter der letzten. */
function buildFigures(figures: readonly (() => Element)[], caption: string | undefined): HTMLElement[] {
  return figures.map((build, index) => {
    const figure = Object.assign(document.createElement("figure"), { className: "rules-figure" });
    figure.append(build());
    if (caption && index === figures.length - 1) figure.append(Object.assign(document.createElement("figcaption"), { textContent: caption }));
    return figure;
  });
}

function screenshot(url: string): HTMLImageElement {
  return Object.assign(document.createElement("img"), { src: url, alt: "", loading: "lazy" });
}

/** Je Admiral Porträt, Name und Beiname, sein Flaggschiff und die Karte seiner Fähigkeit. */
function admiralGallery(): HTMLElement {
  const grid = Object.assign(document.createElement("div"), { className: "rules-admirals" });
  for (const admiral of ADMIRAL_IDS) {
    const entry = Object.assign(document.createElement("div"), { className: "rules-admiral" });
    entry.style.setProperty("--admiral-rgb", `var(--${admiral})`);
    const portrait = Object.assign(document.createElement("img"), { className: "portrait", src: admiralPortrait(admiral), alt: "", loading: "lazy" });
    const name = Object.assign(document.createElement("div"), { className: "identity" });
    name.append(
      Object.assign(document.createElement("b"), { textContent: t.admirals[admiral].name }),
      Object.assign(document.createElement("span"), { textContent: t.admirals[admiral].epithet }),
    );
    const cards = Object.assign(document.createElement("div"), { className: "cards" });
    cards.append(createCard(shipById(ADMIRALS[admiral].flagship)), createPowerCard(admiral));
    entry.append(portrait, name, cards);
    grid.append(entry);
  }
  return grid;
}

/** Alle Schiffe als Karte mit Klasse, Werten und Effekt, danach die Tokens wie die Drohne und die Flaggschiffe. */
function shipGallery(): HTMLElement {
  return gallery(
    [...SHIPS, ...TOKENS, ...FLAGSHIPS].map((card) => {
      const admiral = flagshipAdmiral(card.id);
      const origin = admiral ? t.rules.flagship(admiralTitle(admiral)) : isToken(card) ? t.rules.token : null;
      return {
        card,
        meta: [t.shipClasses[card.shipClass], origin].filter(Boolean).join(" · "),
        lines: [
          `${t.stats.hp} ${card.hp} · ${t.stats.atk} ${card.atk}${card.shield > 0 ? ` · ${t.stats.shield} ${card.shield}` : ""}`,
          admiral ? `${t.admirals[admiral].ability}: ${cardText(card).effect}` : cardText(card).effect,
        ],
      };
    }),
  );
}

/** Alle Befehle, nach Typ in der Reihenfolge der Auflösung gruppiert. */
function commandGallery(): HTMLElement {
  const container = document.createElement("div");
  COMMAND_ORDER.forEach((type: CommandType, index) => {
    container.append(Object.assign(document.createElement("h4"), { textContent: `${index + 1}. ${t.rules.commandTypes[type]}` }));
    container.append(
      gallery(
        COMMANDS.filter((card) => card.commandType === type).map((card) => ({
          card,
          meta: cardText(card).target ?? t.targets[card.targetMode],
          lines: [cardText(card).effect],
        })),
      ),
    );
  });
  return container;
}

function gallery(entries: readonly { card: Card; meta: string; lines: readonly string[] }[]): HTMLElement {
  const grid = Object.assign(document.createElement("div"), { className: "rules-gallery" });
  for (const { card, meta, lines } of entries) {
    const entry = Object.assign(document.createElement("div"), { className: "rules-card" });
    const description = Object.assign(document.createElement("div"), { className: "description" });
    description.append(
      Object.assign(document.createElement("b"), { textContent: cardText(card).name }),
      Object.assign(document.createElement("span"), {
        className: "meta",
        textContent: [meta, deckCopies(card) > 0 && t.rules.copies(deckCopies(card))].filter(Boolean).join(" · "),
      }),
      ...lines.map((line) => Object.assign(document.createElement("span"), { textContent: line })),
    );
    entry.append(createCard(card), description);
    grid.append(entry);
  }
  return grid;
}
