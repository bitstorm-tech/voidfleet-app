// Illustrationen des Regel-Dialogs: Brett mit Deckungsregel und Zielwahl je Klasse als
// Inline-SVG, Phasenfolge, Overdrive-Verlauf und die Teile eines Zugs als DOM (Schiff, Befehl,
// Manöver oder Admiralsfähigkeit). Beschriftet aus `t.rules.figures`; Farben kommen aus den
// CSS-Variablen der Palette (`styles.css`).

import { overdriveBonus } from "../../../shared/board.ts";
import { commandById, shipById } from "../../../shared/cards.ts";
import { t } from "../i18n/index.ts";
import { createCard } from "./cardView.ts";
import { createPowerCard } from "./powerCard.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const labels = t.rules.figures;

/** SVG-Element mit Attributen; `text` wird als Inhalt gesetzt. */
function svgElement(name: string, attributes: Record<string, string | number>, text?: string): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function svgRoot(width: number, height: number): SVGSVGElement {
  return svgElement("svg", { viewBox: `0 0 ${width} ${height}`, class: "rules-svg" }) as SVGSVGElement;
}

/** Schiffssymbol mit der Nase nach oben (eigene Schiffe) oder unten (Gegner). */
function ship(cx: number, cy: number, side: "player" | "enemy", muted = false): SVGElement {
  const dir = side === "player" ? -1 : 1;
  const points = [
    [cx, cy + 14 * dir],
    [cx + 10, cy - 9 * dir],
    [cx, cy - 4 * dir],
    [cx - 10, cy - 9 * dir],
  ];
  return svgElement("path", {
    d: `M${points.map(([x, y]) => `${x},${y}`).join("L")}Z`,
    class: `${side}${muted ? " muted" : ""}`,
  });
}

function slot(x: number, y: number, width: number, height: number, side: "player" | "enemy", highlight?: "covered" | "exposed"): SVGElement {
  return svgElement("rect", { x, y, width, height, rx: 3, class: `slot ${side}${highlight ? ` ${highlight}` : ""}` });
}

function text(x: number, y: number, content: string, className = "", anchor: "start" | "middle" | "end" = "start"): SVGElement {
  return svgElement("text", { x, y, class: className, "text-anchor": anchor }, content);
}

function arrow(from: [number, number], to: [number, number], className: string): SVGElement {
  return svgElement("line", { x1: from[0], y1: from[1], x2: to[0], y2: to[1], class: className, "marker-end": "url(#rules-arrowhead)" });
}

function arrowheadDefs(): SVGElement {
  const defs = svgElement("defs", {});
  const marker = svgElement("marker", { id: "rules-arrowhead", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
  marker.append(svgElement("path", { d: "M0,0 L10,5 L0,10 Z", class: "arrowhead" }));
  defs.append(marker);
  return defs;
}

/**
 * Das Brett: oben der Gegner (Command, Strike), unten die eigene Seite (Strike, Command). Eigene
 * Command-Schiffe hinter einem Strike-Schiff sind gedeckt, die anderen ungedeckt; eine gestrichelte
 * Linie zeigt den Schuss auf das ungedeckte und den abgefangenen auf das gedeckte Schiff.
 */
export function boardFigure(): SVGSVGElement {
  const svg = svgRoot(640, 300);
  svg.append(arrowheadDefs());
  const slotWidth = 80;
  const step = 86;
  const slotHeight = 46;
  const x0 = 100;
  const center = (index: number) => x0 + index * step + slotWidth / 2;
  const rows = [
    { y: 10, side: "enemy", lane: "command" },
    { y: 64, side: "enemy", lane: "strike" },
    { y: 150, side: "player", lane: "strike" },
    { y: 204, side: "player", lane: "command" },
  ] as const;
  const middle = (row: (typeof rows)[number]) => row.y + slotHeight / 2;
  const playerShips = { strike: [1, 3], command: [1, 4] };
  const enemyShips = { strike: [2], command: [2] };

  svg.append(text(0, 20, labels.enemy, "side-label enemy"), text(0, 242, labels.you, "side-label player"));
  svg.append(svgElement("line", { x1: 0, y1: 130, x2: 640, y2: 130, class: "divider" }));
  for (const row of rows) {
    svg.append(text(0, middle(row) + 4, t.lanes[row.lane], "lane-label"));
    const ships = row.side === "player" ? playerShips[row.lane] : enemyShips[row.lane];
    for (let index = 0; index < 6; index++) {
      const covered = row.lane === "command" && ships.includes(index) ? ((row.side === "player" ? playerShips : enemyShips).strike.includes(index) ? "covered" : "exposed") : undefined;
      svg.append(slot(x0 + index * step, row.y, slotWidth, slotHeight, row.side, covered));
      if (row.side === "player" && row.lane === "strike") svg.append(text(center(index), row.y - 5, labels.slot(index), "slot-label", "middle"));
      if (ships.includes(index)) svg.append(ship(center(index), middle(row), row.side));
    }
  }
  const strikeRow = rows[1];
  const playerStrike = rows[2];
  const playerCommand = rows[3];
  // Schuss des Gegners auf das ungedeckte Command-Schiff und der abgefangene auf das gedeckte.
  svg.append(arrow([center(2) + 8, middle(strikeRow) + 12], [center(4) - 4, playerCommand.y - 2], "shot"));
  svg.append(svgElement("line", { x1: center(2) - 8, y1: middle(strikeRow) + 12, x2: center(1) + 2, y2: playerStrike.y - 2, class: "shot blocked" }));
  svg.append(text(center(1), playerCommand.y + slotHeight + 16, labels.covered, "badge covered", "middle"));
  svg.append(text(center(4), playerCommand.y + slotHeight + 16, labels.exposed, "badge exposed", "middle"));
  svg.append(text(640, 292, labels.laneLimit, "note", "end"));
  return svg;
}

/** Zielwahl im Kampf: je Klasse ein Block mit drei Gegnern oben und dem Angreifer unten. */
export function targetingFigure(): SVGSVGElement {
  const svg = svgRoot(640, 172);
  svg.append(arrowheadDefs());
  const blocks = [
    { shipClass: "fighter", chosen: 1, reason: labels.lowestHp },
    { shipClass: "battleship", chosen: 2, reason: labels.highestAtk },
    { shipClass: "cruiser", chosen: 0, reason: labels.opposite },
  ] as const;
  const targets: readonly [number, number][] = [
    [8, 2],
    [5, 1],
    [12, 3],
  ];
  const slotWidth = 62;
  const step = 68;
  const slotHeight = 34;
  blocks.forEach((block, blockIndex) => {
    const ox = blockIndex * 218;
    const cx = (index: number) => ox + index * step + slotWidth / 2;
    svg.append(text(ox, 12, t.shipClasses[block.shipClass], "class-label"));
    targets.forEach(([hp, atk], index) => {
      svg.append(slot(ox + index * step, 24, slotWidth, slotHeight, "enemy", index === block.chosen ? "exposed" : undefined));
      svg.append(ship(cx(index), 24 + slotHeight / 2, "enemy"));
      svg.append(text(cx(index), 72, labels.stat(hp, atk), "stat", "middle"));
    });
    svg.append(slot(ox, 104, slotWidth, slotHeight, "player"));
    svg.append(ship(cx(0), 104 + slotHeight / 2, "player"));
    svg.append(arrow([cx(0) + 4, 100], [cx(block.chosen) - (block.chosen === 0 ? 0 : 6), 24 + slotHeight + 18], "shot"));
    svg.append(text(ox + slotWidth + 10, 126, block.reason, "badge exposed"));
  });
  return svg;
}

/** Die Phasen einer Runde in Reihenfolge, nummeriert, mit Kurztext. */
export function phasesFigure(): HTMLElement {
  const list = Object.assign(document.createElement("ol"), { className: "rules-phases" });
  for (const phase of Object.values(t.rules.phases)) {
    const item = document.createElement("li");
    item.append(Object.assign(document.createElement("b"), { textContent: phase.name }), Object.assign(document.createElement("span"), { textContent: phase.text }));
    list.append(item);
  }
  return list;
}

/** Zeitleiste des Overdrives: je ein Abschnitt pro Bonus-Stufe, Breite nach Rundenzahl. */
export function overdriveFigure(): HTMLElement {
  const container = Object.assign(document.createElement("div"), { className: "rules-overdrive" });
  const lastRound = 19;
  let from = 1;
  for (let round = 2; round <= lastRound + 1; round++) {
    const bonus = overdriveBonus(from);
    if (round <= lastRound && overdriveBonus(round) === bonus) continue;
    const segment = Object.assign(document.createElement("div"), { className: "segment" });
    segment.style.setProperty("--span", String(round - from));
    segment.style.setProperty("--level", String(bonus));
    const to = round > lastRound ? null : round - 1;
    segment.append(
      Object.assign(document.createElement("span"), { textContent: labels.rounds(from, to) }),
      Object.assign(document.createElement("b"), { textContent: labels.overdrive(bonus) }),
    );
    container.append(segment);
    from = round;
  }
  return container;
}

/** Die drei Teile eines Zugs: Schiffskarte, Befehlskarte und das Manöver-Symbol oder die Admiralsfähigkeit. */
export function turnFigure(): HTMLElement {
  const container = Object.assign(document.createElement("div"), { className: "rules-turn" });
  const frame = (content: Element) => {
    const element = Object.assign(document.createElement("div"), { className: "frame" });
    element.append(content);
    return element;
  };
  const part = (frames: readonly Element[], label: string) => {
    const wrapper = Object.assign(document.createElement("div"), { className: "part" });
    const row = Object.assign(document.createElement("div"), { className: "frames" });
    row.append(...frames);
    wrapper.append(row, Object.assign(document.createElement("span"), { textContent: label }));
    return wrapper;
  };
  const plus = () => Object.assign(document.createElement("span"), { className: "plus", textContent: "+" });
  const maneuverIcon = svgRoot(140, 196);
  maneuverIcon.append(arrowheadDefs());
  maneuverIcon.append(slot(20, 120, 100, 50, "player"), slot(20, 26, 100, 50, "player"), ship(70, 145, "player", true), ship(70, 51, "player"));
  maneuverIcon.append(svgElement("path", { d: "M100,118 C130,90 130,56 112,52", class: "move", "marker-end": "url(#rules-arrowhead)" }));
  const [shipPart, commandPart, maneuverPart] = labels.turnParts;
  const or = Object.assign(document.createElement("span"), { className: "or", textContent: labels.or });
  container.append(
    part([frame(createCard(shipById("void_interceptor")))], shipPart!),
    plus(),
    part([frame(createCard(commandById("overcharge")))], commandPart!),
    plus(),
    part([frame(maneuverIcon), or, frame(createPowerCard("kerr"))], maneuverPart!),
  );
  container.append(Object.assign(document.createElement("span"), { className: "note", textContent: labels.roundOne }));
  return container;
}
