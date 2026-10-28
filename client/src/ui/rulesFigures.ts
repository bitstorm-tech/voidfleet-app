// Illustrationen des Regel-Dialogs: Brett mit Spalten und Deckungsregel und die Feuerbefehle (Spalten-
// und Schiffsfeuer) als Inline-SVG, Phasenfolge, Overdrive-Verlauf und die Teile eines Zugs als DOM
// (Schiff, Befehl, Manöver oder Admiralsfähigkeit, Feuerbefehle). Beschriftet aus `t.rules.figures`;
// Farben kommen aus den CSS-Variablen der Palette (`styles.css`).

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
  const marker = svgElement("marker", {
    id: "rules-arrowhead",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto-start-reverse",
  });
  marker.append(svgElement("path", { d: "M0,0 L10,5 L0,10 Z", class: "arrowhead" }));
  defs.append(marker);
  return defs;
}

/**
 * Das Brett: oben der Gegner (Command, Strike), unten die eigene Seite (Strike, Command), darunter die Nummern der
 * Slots, die zugleich die Spalten zählen. Eigene Command-Schiffe hinter einem Strike-Schiff sind gedeckt, die anderen
 * ungedeckt; zwei gegnerische Schüsse fallen in eigene Spalten, in der gedeckten auf das Schiff vorn, sonst auf das
 * Command-Schiff.
 */
export function boardFigure(): SVGSVGElement {
  const svg = svgRoot(640, 316);
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
      const covered =
        row.lane === "command" && ships.includes(index)
          ? (row.side === "player" ? playerShips : enemyShips).strike.includes(index)
            ? "covered"
            : "exposed"
          : undefined;
      svg.append(slot(x0 + index * step, row.y, slotWidth, slotHeight, row.side, covered));
      if (row.side === "player" && row.lane === "command")
        svg.append(text(center(index), row.y + slotHeight + 14, labels.slot(index + 1), "slot-label", "middle"));
      if (ships.includes(index)) svg.append(ship(center(index), middle(row), row.side));
    }
  }
  const [commandRow, strikeRow, playerStrike, playerCommand] = rows;
  // Die Schüsse des Gegners: in die Spalte ohne Strike-Schiff auf das ungedeckte Command-Schiff, in die gedeckte auf das Schiff vorn.
  svg.append(arrow([center(2) + 8, middle(strikeRow) + 12], [center(4) - 4, playerCommand.y - 2], "shot"));
  svg.append(arrow([center(2) - 8, middle(commandRow) + 12], [center(1) + 4, playerStrike.y - 2], "shot"));
  svg.append(text(center(1), playerCommand.y + slotHeight + 30, labels.covered, "badge covered", "middle"));
  svg.append(text(center(4), playerCommand.y + slotHeight + 30, labels.exposed, "badge exposed", "middle"));
  svg.append(text(640, 310, labels.laneLimit, "note", "end"));
  return svg;
}

type FigureRow = "command" | "strike" | "own";
/** Ein Slot in einer Spalte der Feuerbefehl-Figur: Reihe (gegnerische Command- und Strike-Lane, eigene Strike-Lane) und Nummer. */
type Spot = readonly [row: FigureRow, slot: number];
type Point = [x: number, y: number];

/**
 * Feuerbefehle im Kampf, vier Fälle im Raster, je oben die Gegnerseite (Command, Strike), unten eigene Schiffe. Oben
 * Spaltenfeuer: Es trifft das vordere Schiff seiner Spalte und, sobald das gefallen ist, das dahinter; ein Schiff, das
 * die Spalte verlässt, weicht ihm aus. Unten Schiffsfeuer: Es folgt seinem Schiff in einen anderen Slot und verpufft,
 * solange das Schiff gedeckt ist. Gepunktet ist der Feuerbefehl (Rahmen um die Spalte bzw. Ring um das Schiff), rot der
 * Schuss, blass mit Kreuz statt Spitze einer, der verpufft; rot markiert sind die getroffenen Slots, grün der gedeckte,
 * die Ziffern zählen die Schüsse in ihrer Reihenfolge.
 */
export function fireOrdersFigure(): SVGSVGElement {
  const svg = svgRoot(640, 334);
  svg.append(arrowheadDefs());
  const slotWidth = 58;
  const step = 64;
  const slotHeight = 30;
  const rows: Record<FigureRow, number> = { command: 32, strike: 66, own: 126 };
  const same = (a: Spot, b: Spot) => a[0] === b[0] && a[1] === b[1];
  /**
   * Zeichnet Titel, Slots und Schiffe eines Falls, mittig in seiner Hälfte der Zeile, und gibt zurück, wo seine Slots
   * liegen (`edge` -1 oben, 1 unten, 0 Mitte).
   */
  const panel = (index: number, title: string, note: string, ships: readonly Spot[], hit: readonly Spot[], covered?: Spot) => {
    const [cx, oy] = [160 + (index % 2) * 320, Math.floor(index / 2) * 176];
    const ox = cx - step - slotWidth / 2;
    const at = ([row, slotIndex]: Spot, edge = 0): Point => [ox + slotIndex * step + slotWidth / 2, oy + rows[row] + ((1 + edge) * slotHeight) / 2];
    svg.append(text(cx, oy + 11, title, "class-label", "middle"), text(cx, oy + 24, note, "note", "middle"));
    for (const row of ["command", "strike", "own"] as const) {
      for (let slotIndex = 0; slotIndex < 3; slotIndex++) {
        const spot: Spot = [row, slotIndex];
        const highlight = hit.some((other) => same(other, spot)) ? "exposed" : covered && same(covered, spot) ? "covered" : undefined;
        svg.append(slot(ox + slotIndex * step, oy + rows[row], slotWidth, slotHeight, row === "own" ? "player" : "enemy", highlight));
      }
    }
    for (const spot of ships) svg.append(ship(...at(spot), spot[0] === "own" ? "player" : "enemy"));
    return at;
  };
  const shift = ([x, y]: Point, dx: number, dy = 0): Point => [x + dx, y + dy];
  /** Spaltenfeuer: der Rahmen um beide Slots der Spalte, zwischen der Mitte ihrer Oberkante `top` und ihrer Unterkante `bottom`. */
  const column = ([x, top]: Point, [, bottom]: Point) =>
    svgElement("rect", { x: x - slotWidth / 2 - 3, y: top - 3, width: slotWidth + 6, height: bottom - top + 6, rx: 5, class: "order", fill: "none" });
  /** Schiffsfeuer: der Ring um das verfolgte Schiff. */
  const ring = ([x, y]: Point) => svgElement("circle", { cx: x, cy: y + 2, r: 16, class: "order", fill: "none" });
  /** Ein Schuss, der verpufft: blass, mit einem durchgezogenen Kreuz statt der Spitze, `stop` vor dem Punkt `to`. */
  const fizzle = ([fromX, fromY]: Point, [toX, toY]: Point, stop = 0) => {
    const ratio = 1 - stop / Math.hypot(toX - fromX, toY - fromY);
    const [x, y] = [fromX + (toX - fromX) * ratio, fromY + (toY - fromY) * ratio];
    return [
      svgElement("line", { x1: fromX, y1: fromY, x2: x, y2: y, class: "shot blocked" }),
      svgElement("path", {
        d: `M${x - 5},${y - 5}L${x + 5},${y + 5}M${x + 5},${y - 5}L${x - 5},${y + 5}`,
        class: "shot blocked cross",
      }),
    ];
  };
  /** Ein in diesem Kampf zerstörtes Schiff: matt und durchgestrichen. */
  const wreck = ([x, y]: Point) => [
    ship(x, y, "enemy", true),
    ...[-9, 9].map((dx) => svgElement("line", { x1: x + dx, y1: y - 9, x2: x - dx, y2: y + 9, class: "wreck" })),
  ];
  /** Das Manöver eines gegnerischen Schiffs innerhalb der Lane, als flacher Bogen über den Slots, dünner als im Zug-Bild. */
  const move = ([fromX, y]: Point, [toX]: Point) =>
    svgElement("path", {
      d: `M${fromX + 8},${y - 6} Q${(fromX + toX) / 2},${y - 22} ${toX - 14},${y - 6}`,
      class: "move thin",
      "marker-end": "url(#rules-arrowhead)",
    });

  // Spaltenfeuer, zwei Schüsse in dieselbe Spalte: Der erste zerstört das Schiff vorn, der zweite geht auf das dahinter.
  const through = panel(
    0,
    labels.columnFire,
    labels.columnThrough,
    [
      ["command", 1],
      ["own", 0],
      ["own", 2],
    ],
    [
      ["strike", 1],
      ["command", 1],
    ],
  );
  svg.append(
    column(through(["command", 1], -1), through(["strike", 1], 1)),
    ...wreck(through(["strike", 1])),
    arrow(through(["own", 0], -1), shift(through(["strike", 1], 1), -10), "shot"),
    arrow(through(["own", 2], -1), shift(through(["command", 1], 1), 8), "shot"),
  );
  for (const [label, spot] of [
    ["1", ["own", 0]],
    ["2", ["own", 2]],
  ] as const)
    svg.append(text(...shift(through(spot), 16, 4), label, "note"));

  // Spaltenfeuer, das Ziel manövriert aus der Spalte: Der Schuss verpufft im leeren Slot.
  const dodge = panel(
    1,
    labels.columnFire,
    labels.columnDodge,
    [
      ["strike", 2],
      ["own", 1],
    ],
    [],
  );
  svg.append(
    column(dodge(["command", 1], -1), dodge(["strike", 1], 1)),
    move(dodge(["strike", 1]), dodge(["strike", 2])),
    ...fizzle(dodge(["own", 1], -1), dodge(["strike", 1], 0.3)),
  );

  // Schiffsfeuer, dasselbe Manöver: Der Schuss folgt dem Schiff in den neuen Slot.
  const follows = panel(
    2,
    labels.trackingFire,
    labels.trackingFollows,
    [
      ["strike", 2],
      ["own", 1],
    ],
    [["strike", 2]],
  );
  svg.append(
    move(follows(["strike", 1]), follows(["strike", 2])),
    ring(follows(["strike", 2])),
    arrow(follows(["own", 1], -1), follows(["strike", 2], 1), "shot"),
  );

  // Schiffsfeuer auf ein gedecktes Schiff: Solange das Schiff davor steht, verpufft der Schuss.
  const covered = panel(
    3,
    labels.trackingFire,
    labels.trackingCovered,
    [
      ["command", 1],
      ["strike", 1],
      ["own", 0],
    ],
    [],
    ["command", 1],
  );
  // Das Kreuz bleibt knapp vor dem Ring, damit beide zu sehen sind.
  svg.append(ring(covered(["command", 1])), ...fizzle(covered(["own", 0], -1), shift(covered(["command", 1]), 0, 2), 24));
  return svg;
}

/** Die Phasen einer Runde in Reihenfolge, nummeriert, mit Kurztext. */
export function phasesFigure(): HTMLElement {
  const list = Object.assign(document.createElement("ol"), { className: "rules-phases" });
  for (const phase of Object.values(t.rules.phases)) {
    const item = document.createElement("li");
    item.append(
      Object.assign(document.createElement("b"), { textContent: phase.name }),
      Object.assign(document.createElement("span"), { textContent: phase.text }),
    );
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

/**
 * Die Teile eines Zugs: Schiffskarte, Befehlskarte, das Manöver-Symbol oder die Admiralsfähigkeit und die Feuerbefehle
 * (zwei eigene Schiffe feuern über Kreuz auf zwei gegnerische).
 */
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
  const fireIcon = svgRoot(140, 196);
  fireIcon.append(arrowheadDefs());
  for (const x of [8, 76])
    fireIcon.append(slot(x, 26, 56, 50, "enemy"), slot(x, 120, 56, 50, "player"), ship(x + 28, 51, "enemy"), ship(x + 28, 145, "player"));
  fireIcon.append(arrow([40, 116], [100, 80], "shot"), arrow([100, 116], [40, 80], "shot"));
  const [shipPart, commandPart, maneuverPart, firePart] = labels.turnParts;
  const or = Object.assign(document.createElement("span"), { className: "or", textContent: labels.or });
  container.append(
    part([frame(createCard(shipById("void_interceptor")))], shipPart!),
    plus(),
    part([frame(createCard(commandById("overcharge")))], commandPart!),
    plus(),
    part([frame(maneuverIcon), or, frame(createPowerCard("kerr"))], maneuverPart!),
    plus(),
    part([frame(fireIcon)], firePart!),
  );
  container.append(Object.assign(document.createElement("span"), { className: "note", textContent: labels.roundOne }));
  return container;
}
