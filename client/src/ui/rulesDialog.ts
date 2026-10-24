// Spielregeln: Fragezeichen-Knopf links neben dem Zahnrad öffnet einen großen modalen
// Dialog mit Kapitelnavigation links und dem Regeltext rechts. Die Texte kommen aus
// `t.rules.sections`; jedes Kapitel bekommt hier seine Illustration (`rulesFigures.ts`),
// Screenshots aus `assets/images/rules/` oder die Galerie aller Karten (`cardView.ts`).

import { COMMAND_ORDER, COMMANDS, deckCopies, SHIPS, TOKENS, type Card, type CommandType } from "../../../shared/cards.ts";
import deployScreenshot from "../../assets/images/rules/deploy.jpg";
import maneuverScreenshot from "../../assets/images/rules/maneuver.jpg";
import type { Messages, RulesSection } from "../i18n/en.ts";
import { cardText, t } from "../i18n/index.ts";
import { createCard } from "./cardView.ts";
import { iconDialog } from "./iconDialog.ts";
import { boardFigure, overdriveFigure, phasesFigure, targetingFigure, turnFigure } from "./rulesFigures.ts";

type SectionId = keyof Messages["rules"]["sections"];

const ICON = `<circle cx="12" cy="12" r="10" />
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
  <line x1="12" y1="17" x2="12.01" y2="17" />`;

/** Kapitel in Lesereihenfolge; die Illustration steht nach dem Absatz `after` (Standard: nach dem letzten). */
const CHAPTERS: readonly { id: SectionId; figures?: (() => Element)[]; after?: number }[] = [
  { id: "goal", figures: [overdriveFigure] },
  { id: "turn", figures: [turnFigure, () => screenshot(deployScreenshot)], after: 2 },
  { id: "board", figures: [boardFigure], after: 2 },
  { id: "movement", figures: [() => screenshot(maneuverScreenshot)], after: 1 },
  { id: "resolution", figures: [phasesFigure] },
  { id: "combat", figures: [targetingFigure], after: 1 },
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

/** Alle Schiffe als Karte mit Werten, Klasse und ihrem Zielverhalten, zuletzt die Tokens wie die Drohne. */
function shipGallery(): HTMLElement {
  return gallery(
    [...SHIPS, ...TOKENS].map((card) => ({
      card,
      meta: t.shipClasses[card.shipClass],
      lines: [
        `${t.stats.hp} ${card.hp} · ${t.stats.atk} ${card.atk}${card.shield > 0 ? ` · ${t.stats.shield} ${card.shield}` : ""}`,
        cardText(card).effect,
        `${t.shipClasses[card.shipClass]} ${t.rules.classes[card.shipClass]}`,
      ],
    })),
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
          meta: t.targets[card.targetMode],
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
      Object.assign(document.createElement("span"), { className: "meta", textContent: [meta, deckCopies(card) > 0 && t.rules.copies(deckCopies(card))].filter(Boolean).join(" · ") }),
      ...lines.map((line) => Object.assign(document.createElement("span"), { textContent: line })),
    );
    entry.append(createCard(card), description);
    grid.append(entry);
  }
  return grid;
}
