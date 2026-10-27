// Erzeugt das App-Icon über fal.ai (Flux Pro 1.1) und leitet daraus die Icons der installierbaren
// Web-App ab (`assets/app/`): das Quellbild `icon.jpg` (1024×1024, randlos), daraus je Größe ein
// abgerundetes Icon mit transparenten Ecken (`icon-<n>.png`, Zweck „any“, für Desktop und Favicon)
// und ein randloses (`icon-maskable-<n>.png`, das Betriebssystem schneidet selbst zu).
//
//   FAL_KEY=… bun tools/generateAppIcon.ts        # Quellbild nur, wenn es fehlt; Icons immer neu
//   FAL_KEY=… bun tools/generateAppIcon.ts 7      # Quellbild mit Seed 7 neu erzeugen

import sharp from "sharp";

const MODEL = "fal-ai/flux-pro/v1.1";
const OUT_DIR = `${import.meta.dir}/../assets/app`;
const SOURCE = `${OUT_DIR}/icon.jpg`;
const SEED = 1;
const SIZES = [192, 512];
/** Rand und Eckenradius des abgerundeten Icons, relativ zur Kantenlänge. */
const MARGIN = 0.06;
const RADIUS = 0.2;

// „App icon“ im Prompt lässt Flux einen abgerundeten Rahmen malen; die Ecken rundet `writeIcons`.
const PROMPT =
  "Full-bleed square science-fiction illustration, a single sleek angular warship seen from the front in a dramatic three-quarter view, " +
  "centered and filling the middle of the image, dark gunmetal hull with glowing cyan-blue engines and running lights, " +
  "bold simple silhouette that stays readable when shown very small. " +
  "Deep dark space background with a violet nebula glow behind the ship and sparse stars, the background continues to every edge of the image. " +
  "Stylized hard-surface design with faceted shapes and flat cel-like shading, strong rim lighting. " +
  "No text, no letters, no numbers, no logos, no frame, no border, no vignette, no watermark.";

async function generateSource(seed: number, apiKey: string): Promise<void> {
  const response = await fetch(`https://fal.run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: PROMPT,
      image_size: { width: 1024, height: 1024 },
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "4",
      seed,
    }),
  });
  if (!response.ok) throw new Error(`fal antwortet ${response.status} ${await response.text()}`);
  const result = (await response.json()) as { images: { url: string }[] };
  const image = await fetch(result.images[0]!.url);
  if (!image.ok) throw new Error(`Download fehlgeschlagen (${image.status})`);
  await Bun.write(SOURCE, await image.arrayBuffer());
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
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_KEY fehlt in der Umgebung.");
  await generateSource(seedArg === undefined ? SEED : Number(seedArg), apiKey);
}
for (const size of SIZES) await writeIcons(size);
