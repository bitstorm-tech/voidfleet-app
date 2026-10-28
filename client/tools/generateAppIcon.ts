// Erzeugt das App-Icon im Stil „Clean Toon“ und leitet daraus die Icons der installierbaren Web-App ab
// (`assets/app/`): das Quellbild `icon.jpg` (1024×1024, randlos), daraus je Größe ein abgerundetes Icon mit
// transparenten Ecken (`icon-<n>.png`, Zweck „any“, für Desktop und Favicon) und ein randloses
// (`icon-maskable-<n>.png`, das Betriebssystem schneidet selbst zu).
// Das Quellbild entsteht in zwei Stufen wie die Kartenbilder (siehe `generateCardArt.ts`): Das Motiv von Flux Pro 1.1
// (`MOTIF_PROMPT`, Seed `MOTIF_SEED`) liegt im Cache `tools/cache/motifs/icon.jpg`, Nano Banana Pro zeichnet es mit
// der Stilvorlage in Clean Toon neu (`PROMPT`, Seed `SEED`).
//
//   FAL_KEY=… bun tools/generateAppIcon.ts        # Quellbild nur, wenn es fehlt; Icons immer neu
//   FAL_KEY=… bun tools/generateAppIcon.ts 8      # Quellbild mit Seed 8 neu zeichnen (das Motiv bleibt)

import sharp from "sharp";
import { motif, toon } from "./generateCardArt.ts";

const OUT_DIR = `${import.meta.dir}/../assets/app`;
const SOURCE = `${OUT_DIR}/icon.jpg`;
const MOTIF = `${import.meta.dir}/cache/motifs/icon.jpg`;
const MOTIF_SEED = 1;
const SEED = 7;
const SIZES = [192, 512];
/** Rand und Eckenradius des abgerundeten Icons, relativ zur Kantenlänge. */
const MARGIN = 0.06;
const RADIUS = 0.2;

// „App icon“ im Prompt lässt die Modelle einen abgerundeten Rahmen malen; die Ecken rundet `writeIcons`.
const MOTIF_PROMPT =
  "Full-bleed square science-fiction illustration, a single sleek angular warship seen from the front in a dramatic three-quarter view, " +
  "centered and filling the middle of the image, dark gunmetal hull with glowing cyan-blue engines and running lights, " +
  "bold simple silhouette that stays readable when shown very small. " +
  "Deep dark space background with a violet nebula glow behind the ship and sparse stars, the background continues to every edge of the image. " +
  "Stylized hard-surface design with faceted shapes and flat cel-like shading, strong rim lighting. " +
  "No text, no letters, no numbers, no logos, no frame, no border, no vignette, no watermark.";

/** Klein muss vor allem die Silhouette lesbar bleiben: Der dunkle Rumpf steht vor einem gestuften, helleren Glühen. */
const PROMPT =
  "Redraw the first image as a clean cel-shaded illustration in the exact art style of the second image. " +
  "Keep the warship, its silhouette, its front three-quarter view and the centered composition of the first image; " +
  "take only the rendering style, line work and colors from the second image, not its battleship. " +
  "Flat color areas with two or three hard-edged shading steps, crisp even dark navy outlines that are bolder on the outer silhouette, " +
  "no textures, no metallic gloss, no gradients on the ship. Deep desaturated blue-grey hull with glowing cyan-blue (#5CC4FF) engines and running lights. " +
  "A bold simple silhouette that stays readable when shown very small: right behind the ship a large round cel-shaded glow in cool steel blue " +
  "with two or three hard-edged tone steps, fading into calm dark navy space with a few sparse small stars toward the edges; " +
  "the background continues to every edge of the image. " +
  "No text, no letters, no numbers, no logos, no frame, no border, no vignette, no watermark.";

async function generateSource(seed: number): Promise<void> {
  if (!Bun.file(MOTIF).size) {
    await Bun.write(MOTIF, await motif(MOTIF_PROMPT, MOTIF_SEED, { width: 1024, height: 1024 }));
    console.log(`✓ Motiv (Seed ${MOTIF_SEED})`);
  }
  await sharp(await toon(PROMPT, seed, "1:1", [MOTIF]))
    .resize(1024, 1024)
    .jpeg({ quality: 92 })
    .toFile(SOURCE);
  console.log(`✓ icon.jpg (Seed ${seed})`);
}

async function writeIcons(size: number): Promise<void> {
  await sharp(SOURCE).resize(size, size).png().toFile(`${OUT_DIR}/icon-maskable-${size}.png`);

  const inner = Math.round(size * (1 - 2 * MARGIN));
  const radius = Math.round(inner * RADIUS);
  const mask = Buffer.from(`<svg width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${radius}" fill="#fff"/></svg>`);
  const rounded = await sharp(SOURCE)
    .resize(inner, inner)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: rounded, gravity: "center" }])
    .png()
    .toFile(`${OUT_DIR}/icon-${size}.png`);
  console.log(`✓ icon-${size}.png, icon-maskable-${size}.png`);
}

const seedArg = process.argv[2];
if (seedArg !== undefined || !Bun.file(SOURCE).size) {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY fehlt in der Umgebung.");
  await generateSource(seedArg === undefined ? SEED : Number(seedArg));
}
for (const size of SIZES) await writeIcons(size);
