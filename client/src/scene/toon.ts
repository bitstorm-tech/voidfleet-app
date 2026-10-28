// Clean Toon: Material, Konturen und Glühen der Schiffe und Wracks, gebaut nach dem Material-Vertrag aus
// `tools/ships/vf.py` (`material.metadata.gltf.extras.vf`) und den Look-Parametern aus `tools/ships/look.py`.
//
// Material: ein ShaderMaterial für alle Arten (`toon`, `light`, `hologram`, `wreck`); nur die Bruchflächen der Wracks
// brauchen eine zweite Variante (Glutmuster über UVs). Licht ist gerechnet, nicht beleuchtet: drei Töne, hart gestuft
// über N·L des Hauptlichts, dazu Kantenlicht, Saum und Glanzpunkt; die Kanten der Stufen sind auf runden Teilen über
// die Bildableitung geglättet. Das Hauptlicht hängt fest am Brett, je Seite gespiegelt: Beide Flotten werden wie in der
// Blender-Vorschau von vorn oben und von der Kameraseite der Seitenansicht beleuchtet, und beim Drehen und Zoomen der
// Kamera kippt kein Ton. Das Blitzlicht der Explosionen hellt die zugewandten Flächen in zwei harten Stufen auf.
// Schlagschatten fehlen bewusst: In Brettgröße sind sie wenige Pixel groß, kosten aber zwei Schattenkarten je Bild (das
// Licht ist je Seite gespiegelt) und würden an den kleinen, sich überlappenden Teilen ausfransen und beim Bewegen kriechen.
//
// Konturen: Vor dem Bild zeichnet ein Kantenpuffer (4× MSAA, halbe Floats, höchstens etwa 1080p) nur die Schiffe mit
// Normale und Tiefe; geräumt bleibt er (0, 0, 0, 0), aufgelöst trägt also jedes Pixel seinen Deckungsgrad. Das Material
// liest ihn rund um sein eigenes Pixel und dunkelt sich selbst ab: Außenkontur gegen den Hintergrund (oder ein weit
// dahinter liegendes Schiff), Silhouetten innerhalb des Schiffs (Tiefensprung) und Kanten (Knick der Normale). Die
// Linien liegen so innen am Umriss, haben eine feste Breite in CSS-Pixeln und werden von allem verdeckt, was davor liegt
// (Effekte, Balken, Geister). Weil der Puffer geglättet ist und bilinear gelesen wird, wandern sie beim Bewegen stufenlos.
//
// Glühen: Lichter mit `glow: true`, glühende Hologrammkanten und die Glut der Bruchflächen kommen in einen eigenen,
// eng weichzeichnenden GlowLayer; alle übrigen Teile verdecken darin, was hinter ihnen leuchtet.

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Material } from "@babylonjs/core/Materials/material";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { type Matrix, Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Scene } from "@babylonjs/core/scene";

/** Der Material-Vertrag (vf.py), Farben als sRGB-Hex. */
export type ToonSpec =
  | { kind: "toon"; tones: [string, string, string]; round: boolean; glint: number }
  | { kind: "light"; color: string; glow: boolean }
  | { kind: "hologram"; color: string; alpha: number; glow: boolean }
  | { kind: "wreck"; tones: [string, string, string]; heat: string };

/**
 * Zustand eines Schiffs, den seine Meshes beim Zeichnen lesen (eine Instanz je `ShipView`, Modell und Wrack teilen sie):
 * Seite für das Hauptlicht, Glut der Bruchflächen (linear, `null`: die Farbe aus dem Vertrag) und Helligkeit der Lichter.
 */
export interface ToonInstance {
  /** +1 eigene Seite (Nase nach rechts), −1 Gegner. */
  facing: number;
  heat: Color3 | null;
  lights: number;
}

// --- Look, Werte aus tools/ships/look.py ---

/**
 * Hauptlicht `KEY["board"]` (−0,25, −0,75, 0,62) aus Blender-Schiffskoordinaten in die Welt eines eigenen Schiffs
 * (Nase +x): von vorn oben, leicht von der Kameraseite der Seitenansicht (−z). Für den Gegner ist x gespiegelt.
 */
const KEY = new Vector3(0.75, 0.62, -0.25).normalize();
/** Schwellen auf N·L: Schatten | Halbschatten | Licht. */
const STEPS = [0.12, 0.5] as const;
const RIM_COLOR = "#86acd2";
const RIM_MIX = 0.65;
/** Kantenlicht von hinten oben: Blickrichtung der Kamera plus so viel „oben“. */
const RIM_UP = 0.9;
/**
 * Schwellen des Kantenlichts auf N·R und facing und die Grenze auf N·oben, für eckige und runde Flächen. Eckige Flächen,
 * die nach oben zeigen (weniger als 37° gegen die Waagrechte geneigt), bekommen keins: Ihr facing liegt im Brettwinkel
 * um die Schwelle 0,4 herum und wechselt mit der Perspektive über die Fläche, große Decks zerfielen sonst entlang einer
 * Kurve in zwei Töne. Runde Flächen erreichen ihre Schwelle oben nie.
 */
const RIM_FLAT = [0.28, 0.4, 0.8] as const;
const RIM_ROUND = [0.0, 0.62, 2] as const;
const SEAM_FACING = 0.86;
const SEAM_MIX = 0.5;
const GLINT_COLOR = "#e4ecf4";
const GLINT_THRESHOLD = 0.975;
const LINE_COLOR = "#0b0e15";
/**
 * Linien in CSS-Pixeln, in Brettgröße nach `LINES["board"]` (1,8 / 1,3 / 0,7): Die Außenkontur liegt ganz innen am
 * Umriss; Silhouetten und Kanten liegen mittig auf dem Sprung und sind je Seite `LINE_RADIUS` breit, die schwächeren
 * Kanten zeichnen mit geringerer Deckkraft.
 */
const CONTOUR_WIDTH = 1.8;
const LINE_RADIUS = 0.6;
const SILHOUETTE_ALPHA = 1;
const CREASE_ALPHA = 0.6;
/** Kanten ab diesem Knick der Normale in Grad (look.py: `CREASE_ANGLE` 140° zwischen den Flächen). */
const CREASE_ANGLE = 40;
/** Silhouetten ab diesem Tiefensprung: mindestens so viele Welteinheiten und so viele Pixelbreiten. */
const SILHOUETTE_JUMP = 0.03;
const SILHOUETTE_PIXELS = 2;
/** Ein Schiff, das so weit (Welteinheiten) hinter einem anderen liegt, gilt für dessen Außenkontur als Hintergrund. */
const FAR_JUMP = 0.8;
/** Blitzlicht der Explosionen: Bestrahlung = Stärke · cos / (1 + Abstand²), zwei harte Stufen, die je so viel aufhellen. */
const FLASH_COLOR = "#ffc488";
const FLASH_STEPS = [1.5, 6] as const;
const FLASH_LIFT = 0.22;
/**
 * Höchstens so viele Pixel hat der Kantenpuffer (etwa 1080p): Auf größeren Bildschirmen ist er kleiner als das Bild und
 * wird weich gelesen, statt mit vierfachem MSAA Hunderte Megabyte zu belegen.
 */
const OUTLINE_PIXELS = 1920 * 1200;
/** Glühen der Schiffslichter (look.py: Radien 3 und 9 px in Brettgröße), viel enger als der GlowLayer der Effekte. */
const GLOW_KERNEL = 16;
const GLOW_INTENSITY = 1.1;
/** Geister eingeplanter Schiffe: bläuliches Hologramm in drei Tönen, ohne Konturen, nur die vorderste Hülle. */
const GHOST_TONES = ["#8fdcff", "#4d9fd6", "#2a5f99"] as const;
const GHOST_LIGHT = "#d6f6ff";
const GHOST_ALPHA = 0.45;
const GHOST_HOLOGRAM_ALPHA = 0.6;

const linear = (hex: string): Color3 => Color3.FromHexString(hex).toLinearSpace(true);
const glsl = (value: number): string => value.toFixed(5);
const glslColor = (hex: string): string => {
  const { r, g, b } = linear(hex);
  return `vec3(${glsl(r)}, ${glsl(g)}, ${glsl(b)})`;
};

Effect.ShadersStore.toonVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
#ifdef HEAT
attribute vec2 uv;
varying vec2 vUV;
#endif
uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProjection;
varying vec3 vPosition;
varying vec3 vNormal;
varying float vDepth;

void main(void) {
    vec4 worldPosition = world * vec4(position, 1.0);
    vPosition = worldPosition.xyz;
    vNormal = mat3(world) * normal;
    vDepth = (view * worldPosition).z;
#ifdef HEAT
    vUV = uv;
#endif
    gl_Position = viewProjection * worldPosition;
}
`;

Effect.ShadersStore.toonFragmentShader = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec3 vPosition;
varying vec3 vNormal;
varying float vDepth;
#ifdef HEAT
varying vec2 vUV;
uniform sampler2D heatSampler;
uniform vec3 heatColor;
#endif

uniform mat4 view;
uniform vec3 cameraPosition;
uniform vec3 keyDirection;
uniform vec3 rimDirection;
uniform vec3 toneLit;
uniform vec3 toneMid;
uniform vec3 toneDark;
// x: gestuft beleuchtet (1) oder genau seine Farbe (0), y: Glanzpunkt
uniform vec2 surface;
// Kantenlicht: Schwellen auf N·R und facing, höchstes N·oben
uniform vec3 rimStyle;
uniform float power;
uniform float opacity;
uniform vec4 flash;
uniform vec3 flashColor;
uniform sampler2D outlineSampler;
// xy: 1 / Bildgröße, z: Gerätepixel je CSS-Pixel (0: keine Linien), w: Pixelbreite je Einheit Tiefe
uniform vec4 outlineInfo;
uniform float depthReference;

const float SHADOW_STEP = ${glsl(STEPS[0])};
const float LIGHT_STEP = ${glsl(STEPS[1])};
const vec3 RIM_COLOR = ${glslColor(RIM_COLOR)};
const float RIM_MIX = ${glsl(RIM_MIX)};
const float SEAM_FACING = ${glsl(SEAM_FACING)};
const float SEAM_MIX = ${glsl(SEAM_MIX)};
const vec3 GLINT_COLOR = ${glslColor(GLINT_COLOR)};
const float GLINT_THRESHOLD = ${glsl(GLINT_THRESHOLD)};
const vec3 LINE_COLOR = ${glslColor(LINE_COLOR)};
const float CONTOUR_WIDTH = ${glsl(CONTOUR_WIDTH)};
const float LINE_RADIUS = ${glsl(LINE_RADIUS)};
const float SILHOUETTE_ALPHA = ${glsl(SILHOUETTE_ALPHA)};
const float CREASE_ALPHA = ${glsl(CREASE_ALPHA)};
const float CREASE_CHORD = ${glsl(2 * Math.sin((CREASE_ANGLE * Math.PI) / 360))};
const float SILHOUETTE_JUMP = ${glsl(SILHOUETTE_JUMP)};
const float SILHOUETTE_PIXELS = ${glsl(SILHOUETTE_PIXELS)};
const float FAR_JUMP = ${glsl(FAR_JUMP)};
const float FLASH_LOW = ${glsl(FLASH_STEPS[0])};
const float FLASH_HIGH = ${glsl(FLASH_STEPS[1])};
const float FLASH_LIFT = ${glsl(FLASH_LIFT)};

// Harte Stufe, deren Kante über die Bildableitung geglättet ist: auf flachen Facetten exakt, auf runden Teilen ohne Treppen.
float band(float edge, float value) {
    float width = max(fwidth(value) * 0.7, 1e-4);
    return smoothstep(edge - width, edge + width, value);
}

vec3 toSrgb(vec3 color) {
    color = clamp(color, 0.0, 1.0);
    return mix(color * 12.92, 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, color));
}

vec4 gbuffer(vec2 offset) {
    return texture2D(outlineSampler, (gl_FragCoord.xy + offset) * outlineInfo.xy);
}

vec3 gbufferNormal(vec4 texel) {
    vec2 xy = texel.xy / max(texel.a, 1e-3);
    return vec3(xy, -sqrt(max(1.0 - dot(xy, xy), 0.0)));
}

// Tiefe eines Texels über der eigenen Ebene (positiv: dahinter), bzw. Abstand seiner Normale von der eigenen (Sehne).
float behindPlane(vec4 texel, float depth, vec2 slope, vec2 offset) {
    return texel.z / max(texel.a, 1e-3) - depth - dot(slope, offset);
}

// Außenkontur: Anteil von Hintergrund oder einem weit dahinter liegenden Schiff im Texel.
float outside(vec4 texel, float behind) {
    return 1.0 - texel.a + texel.a * smoothstep(0.5 * FAR_JUMP, FAR_JUMP, behind);
}

float bend(vec4 texel, vec3 normal) {
    return length(gbufferNormal(texel) - normal);
}

// Linien rund um das eigene Pixel. Die Außenkontur: Ein Ring im Abstand der Linienbreite (und einer auf halbem Weg für
// schmale Lücken) trifft Hintergrund. Silhouetten und Kanten: Je Richtung misst der äußere Nachbar den Sprung von der
// eigenen Ebene bzw. Normale weg, und die Linie liegt dort, wo der innere Nachbar schon mehr als halb auf der anderen
// Seite ist. Weil der Puffer geglättet ist, ist dieser Anteil stetig: Die Linien sind beim Bewegen ruhig und unabhängig
// davon, wie groß der Sprung ist, gleich breit.
float lineCoverage(vec3 normal, float depth) {
    vec2 slope = vec2(dFdx(depth), dFdy(depth));
    float scale = outlineInfo.z;
    float contourRadius = CONTOUR_WIDTH * scale;
    float lineRadius = LINE_RADIUS * scale;
    float jump = max(SILHOUETTE_JUMP, SILHOUETTE_PIXELS * (depth + depthReference) * outlineInfo.w);
    float contour = 1.0 - gbuffer(vec2(0.0)).a;
    float silhouette = 0.0;
    float crease = 0.0;
    for (int i = 0; i < 8; i++) {
        float angle = float(i) * 0.78539816;
        vec2 direction = vec2(cos(angle), sin(angle));
        vec4 far = gbuffer(direction * contourRadius);
        vec4 mid = gbuffer(direction * (0.5 * contourRadius));
        vec4 near = gbuffer(direction * lineRadius);
        float farBehind = behindPlane(far, depth, slope, direction * contourRadius);
        contour = max(contour, max(outside(far, farBehind), outside(mid, behindPlane(mid, depth, slope, direction * (0.5 * contourRadius)))));
        float valid = step(0.5, far.a) * step(0.5, near.a);
        float farStep = abs(farBehind);
        float nearStep = abs(behindPlane(near, depth, slope, direction * lineRadius));
        silhouette = max(silhouette, valid * smoothstep(0.5 * jump, jump, farStep) * smoothstep(0.3, 0.7, nearStep / max(farStep, jump)));
        float farBend = bend(far, normal);
        float nearBend = bend(near, normal);
        crease = max(crease, valid * smoothstep(0.85 * CREASE_CHORD, CREASE_CHORD, farBend) * smoothstep(0.3, 0.7, nearBend / max(farBend, CREASE_CHORD)));
    }
    return clamp(max(contour, max(SILHOUETTE_ALPHA * silhouette, CREASE_ALPHA * crease)), 0.0, 1.0);
}

void main(void) {
    vec3 color = toneLit * power;
    vec3 normal = normalize(vNormal);
    normal = gl_FrontFacing ? normal : -normal;
    if (surface.x > 0.5) {
        vec3 toCamera = normalize(cameraPosition - vPosition);
        float light = max(dot(normal, keyDirection), 0.0);
        color = mix(toneDark, toneMid, band(SHADOW_STEP, light));
        color = mix(color, toneLit, band(LIGHT_STEP, light));
        float facing = 1.0 - abs(dot(normal, toCamera));
        float rim = band(rimStyle.x, dot(normal, rimDirection)) * band(rimStyle.y, facing) * (1.0 - band(rimStyle.z, normal.y));
        float seam = band(SEAM_FACING, facing) * (1.0 - band(SHADOW_STEP, light));
        color = mix(color, RIM_COLOR, RIM_MIX * max(rim, SEAM_MIX * seam));
        color = mix(color, GLINT_COLOR, surface.y * band(GLINT_THRESHOLD, dot(normal, normalize(toCamera + keyDirection))));
        vec3 toFlash = flash.xyz - vPosition;
        float distance2 = dot(toFlash, toFlash);
        float irradiance = flash.w * max(dot(normal, toFlash), 0.0) * inversesqrt(distance2 + 1e-4) / (1.0 + distance2);
        color += flashColor * FLASH_LIFT * (band(FLASH_LOW, irradiance) + band(FLASH_HIGH, irradiance));
#ifdef HEAT
        color += heatColor * pow(texture2D(heatSampler, vUV).r, 2.2);
#endif
    }
    if (outlineInfo.z > 0.0) {
        color = mix(color, LINE_COLOR, lineCoverage(normalize(mat3(view) * normal), vDepth - depthReference));
    }
    gl_FragColor = vec4(toSrgb(color), opacity);
}
`;

Effect.ShadersStore.toonOutlineVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProjection;
varying vec3 vNormal;
varying float vDepth;

void main(void) {
    vec4 worldPosition = world * vec4(position, 1.0);
    vNormal = mat3(view) * (mat3(world) * normal);
    vDepth = (view * worldPosition).z;
    gl_Position = viewProjection * worldPosition;
}
`;

Effect.ShadersStore.toonOutlineFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying float vDepth;
uniform float depthReference;

void main(void) {
    gl_FragColor = vec4(normalize(vNormal).xy, vDepth - depthReference, 1.0);
}
`;

const instances = new WeakMap<AbstractMesh, ToonInstance>();
const renderers = new WeakMap<Scene, ToonRenderer>();
const ghosts = new WeakMap<ToonMaterial, ToonMaterial>();
const DEFAULT_INSTANCE: ToonInstance = { facing: 1, heat: null, lights: 1 };

/** Ein Material der Schiffe und Wracks; was je Schiff wechselt, liest es beim Zeichnen aus dessen `ToonInstance`. */
export class ToonMaterial extends ShaderMaterial {
  /** Bekommt Konturen und liegt im Kantenpuffer: alles außer Hologrammen und Geistern. */
  readonly outlined: boolean;
  /** Farbe im Glühen (sRGB) für Lichter und Hologramme mit `glow`. */
  readonly glowColor: Color3 | null;
  private readonly heat: Color3 | null;

  constructor(
    name: string,
    scene: Scene,
    readonly spec: ToonSpec,
    readonly ghost = false,
    readonly heatTexture: BaseTexture | null = null,
  ) {
    const wreck = spec.kind === "wreck";
    super(name, scene, "toon", {
      attributes: wreck ? ["position", "normal", "uv"] : ["position", "normal"],
      uniforms: [
        "world",
        "view",
        "viewProjection",
        "cameraPosition",
        "keyDirection",
        "rimDirection",
        "toneLit",
        "toneMid",
        "toneDark",
        "surface",
        "rimStyle",
        "power",
        "opacity",
        "flash",
        "flashColor",
        "outlineInfo",
        "depthReference",
        "heatColor",
      ],
      samplers: wreck ? ["outlineSampler", "heatSampler"] : ["outlineSampler"],
      defines: wreck ? ["#define HEAT"] : [],
    });
    // Die Hüllen sind geschlossen und nach außen orientiert (build.py prüft das): Rückseiten fallen weg, nur die offenen
    // Splitter der Hologramme zeichnen beidseitig. Die glTF-Meshes sind gespiegelt (z = −1); mit fester Seitenausrichtung
    // dreht Babylon die Vorderseite mit, und gl_FrontFacing stimmt.
    this.sideOrientation = Material.ClockWiseSideOrientation;
    this.backFaceCulling = spec.kind !== "hologram";
    this.outlined = !ghost && spec.kind !== "hologram";
    this.glowColor = "glow" in spec && spec.glow ? Color3.FromHexString(spec.color) : null;
    this.heat = wreck ? linear(spec.heat) : null;
    if (heatTexture) this.setTexture("heatSampler", heatTexture);
    this.setColor3("flashColor", linear(FLASH_COLOR));

    const lit = "tones" in spec;
    const tones = lit ? (ghost ? GHOST_TONES : spec.tones) : [ghost && spec.kind === "light" ? GHOST_LIGHT : spec.color];
    const [toneLit, toneMid = toneLit, toneDark = toneLit] = tones.map(linear);
    this.setColor3("toneLit", toneLit!).setColor3("toneMid", toneMid!).setColor3("toneDark", toneDark!);
    this.setVector2("surface", new Vector2(lit ? 1 : 0, spec.kind === "toon" ? spec.glint : 0));
    this.setVector3("rimStyle", Vector3.FromArray(spec.kind === "toon" && spec.round ? RIM_ROUND : RIM_FLAT));

    if (spec.kind === "hologram") {
      this.alpha = spec.alpha * (ghost ? GHOST_HOLOGRAM_ALPHA : 1);
      this.disableDepthWrite = true;
    } else if (ghost) {
      this.alpha = GHOST_ALPHA;
      // Nur die vorderste Hülle zeigt sich, statt dass Innenflächen durchscheinen.
      this.needDepthPrePass = true;
    }
  }

  /** Bindet, was je Schiff und je Bild wechselt: Seite, Sichtbarkeit, Glut, Lichter, Blitzlicht und Kantenpuffer. */
  override bind(world: Matrix, mesh?: AbstractMesh, effectOverride?: Effect | null, subMesh?: SubMesh): void {
    super.bind(world, mesh, effectOverride, subMesh);
    const effect = effectOverride ?? subMesh?.effect ?? this.getEffect();
    const renderer = renderers.get(this.getScene());
    if (!effect || !renderer) return;
    const instance = (mesh && instances.get(mesh)) ?? DEFAULT_INSTANCE;
    effect.setFloat3("keyDirection", KEY.x * instance.facing, KEY.y, KEY.z);
    effect.setVector3("rimDirection", renderer.rimDirection);
    effect.setFloat("opacity", this.alpha * (mesh?.visibility ?? 1));
    effect.setFloat("power", this.spec.kind === "light" ? instance.lights : 1);
    if (this.heat) effect.setColor3("heatColor", instance.heat ?? this.heat);
    const { position, intensity } = renderer.flash;
    effect.setFloat4("flash", position.x, position.y, position.z, intensity);
    effect.setTexture("outlineSampler", renderer.outlineBuffer);
    const info = renderer.outlineInfo;
    effect.setFloat4("outlineInfo", info.x, info.y, this.outlined ? info.z : 0, info.w);
    effect.setFloat("depthReference", renderer.depthReference);
  }
}

/** Das Toon-Material zu einem glTF-Material aus `tools/ships/` (Vertrag in `metadata.gltf.extras.vf`). */
export function toonMaterial(source: Material, scene: Scene): ToonMaterial {
  const spec = source.metadata.gltf.extras.vf as ToonSpec;
  return new ToonMaterial(source.name, scene, spec, false, spec.kind === "wreck" ? (source as PBRMaterial).emissiveTexture : null);
}

/** Die Geist-Fassung eines Toon-Materials, einmal je Material angelegt und von allen Geistern geteilt. */
export function ghostMaterial(source: ToonMaterial): ToonMaterial {
  let ghost = ghosts.get(source);
  if (!ghost) {
    ghost = new ToonMaterial(`${source.name}-ghost`, source.getScene(), source.spec, true, source.heatTexture);
    ghosts.set(source, ghost);
  }
  return ghost;
}

/**
 * Was alle Toon-Materialien der Szene je Bild brauchen: Kantenpuffer, Kantenlicht, Bezugstiefe, das Blitzlicht der
 * Explosionen und das Glühen der Schiffslichter. Eine Instanz je Szene (`MatchScene`).
 */
export class ToonRenderer {
  /** Der gerade stärkste Blitz der Explosionen; `BoardEffects` schreibt ihn jedes Bild. */
  readonly flash = { position: Vector3.Zero(), intensity: 0 };
  readonly rimDirection = new Vector3(0, 1, 0);
  /** Siehe `outlineInfo` im Shader. */
  readonly outlineInfo = new Vector4(0, 0, 1, 0);
  /** Tiefe der Brettebene in der Bildmitte: Der Puffer speichert Tiefen relativ dazu, damit halbe Floats genügen. */
  depthReference = 0;
  readonly outlineBuffer: RenderTargetTexture;
  private readonly outlineMaterial: ShaderMaterial;
  private readonly glow: GlowLayer;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    renderers.set(scene, this);
    const engine = scene.getEngine();
    const size = () => {
      const [width, height] = [engine.getRenderWidth(true), engine.getRenderHeight(true)];
      const scale = Math.min(1, Math.sqrt(OUTLINE_PIXELS / (width * height)));
      return { width: Math.round(width * scale), height: Math.round(height * scale) };
    };
    this.outlineBuffer = new RenderTargetTexture("toon-outline", size(), scene, {
      generateMipMaps: false,
      type: Constants.TEXTURETYPE_HALF_FLOAT,
      samplingMode: Texture.BILINEAR_SAMPLINGMODE,
      generateDepthBuffer: true,
      samples: 4,
    });
    this.outlineBuffer.clearColor = new Color4(0, 0, 0, 0);
    this.outlineBuffer.renderParticles = false;
    this.outlineBuffer.renderSprites = false;
    this.outlineBuffer.renderListPredicate = (mesh) => mesh.material instanceof ToonMaterial && mesh.material.outlined && instances.has(mesh);
    scene.customRenderTargets.push(this.outlineBuffer);
    engine.onResizeObservable.add(() => this.outlineBuffer.resize(size()));

    this.outlineMaterial = new ShaderMaterial("toon-outline", scene, "toonOutline", {
      attributes: ["position", "normal"],
      uniforms: ["world", "view", "viewProjection", "depthReference"],
    });
    // Im Kantenpuffer liegen nur geschlossene Hüllen (keine Hologramme), Rückseiten fallen weg wie im Bild.
    this.outlineMaterial.sideOrientation = Material.ClockWiseSideOrientation;

    this.glow = new GlowLayer("ship-glow", scene, { blurKernelSize: GLOW_KERNEL, excludeByDefault: true });
    this.glow.intensity = GLOW_INTENSITY;
    this.glow.customEmissiveColorSelector = (mesh, _subMesh, material, result) => glowColor(mesh, material as ToonMaterial, result);
    this.glow.customEmissiveTextureSelector = (_mesh, _subMesh, material) => (material as ToonMaterial).heatTexture as Texture;

    // Erst hier hat Babylon die Kamera dieses Bilds gerechnet; davor (`onBeforeRenderTargetsRenderObservable`) liefert sie
    // nach einer Bewegung ihres Rigs noch die Lage des letzten Bilds, und Puffer und Bild rechneten mit verschiedener
    // Bezugstiefe: Die Schiffe wären im ersten Bild jeder Kameradrehung ganz Kontur, also schwarz.
    this.outlineBuffer.onBeforeRenderObservable.add(() => this.update());
  }

  /**
   * Meldet ein Mesh eines Schiffs oder Wracks an: Es liest seinen Zustand aus `instance`, kommt ins Glühen und, außer
   * bei Geistern und Hologrammen, in den Kantenpuffer.
   */
  register(mesh: AbstractMesh, instance: ToonInstance): void {
    instances.set(mesh, instance);
    const material = mesh.material as ToonMaterial;
    if (material.ghost) return;
    this.glow.addIncludedOnlyMesh(mesh as Mesh);
    mesh.onDisposeObservable.addOnce(() => this.glow.removeIncludedOnlyMesh(mesh as Mesh));
    if (material.outlined) this.outlineBuffer.setMaterialForRendering(mesh, this.outlineMaterial);
  }

  private update(): void {
    const forward = this.camera.getDirection(Axis.Z);
    this.rimDirection.copyFrom(forward).addInPlaceFromFloats(0, RIM_UP, 0).normalize();
    this.depthReference = this.camera.globalPosition.y / Math.max(-forward.y, 0.1);
    this.outlineMaterial.setFloat("depthReference", this.depthReference);
    const engine = this.scene.getEngine();
    const [width, height] = [engine.getRenderWidth(true), engine.getRenderHeight(true)];
    this.outlineInfo.set(1 / width, 1 / height, 1 / engine.getHardwareScalingLevel(), (2 * Math.tan(this.camera.fov / 2)) / height);
  }
}

/** Lichter und Hologrammkanten mit `glow` und glühende Bruchflächen leuchten, Hologramme sonst gar nicht, der Rest verdeckt. */
function glowColor(mesh: AbstractMesh, material: ToonMaterial, result: Color4): void {
  const { spec, glowColor: color } = material;
  const instance = instances.get(mesh) ?? DEFAULT_INSTANCE;
  if (color) {
    const strength = spec.kind === "hologram" ? material.alpha * mesh.visibility : instance.lights;
    result.set(color.r * strength, color.g * strength, color.b * strength, 1);
  } else if (spec.kind === "hologram") {
    result.set(0, 0, 0, 0);
  } else if (spec.kind === "wreck" && instance.heat) {
    result.set(instance.heat.r, instance.heat.g, instance.heat.b, 1);
  } else {
    result.set(0, 0, 0, 1);
  }
}

/** Der ToonRenderer der Szene. */
export function toonRenderer(scene: Scene): ToonRenderer {
  return renderers.get(scene)!;
}
