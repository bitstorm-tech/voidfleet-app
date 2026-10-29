// Weltraum-Hintergrund als Fullscreen-Layer hinter der 3D-Szene, der den
// Viewport wie "cover" füllt und sich leicht gegen die Kamera verschiebt.
// Jedes Match zeigt zufällig einen der zehn Hintergründe, nie zweimal hintereinander denselben.

import { Layer } from "@babylonjs/core/Layers/layer";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import background01 from "../../assets/images/backgrounds/01-nebelschlucht.png";
import background02 from "../../assets/images/backgrounds/02-ringplanet.png";
import background03 from "../../assets/images/backgrounds/03-asteroidenguertel.png";
import background04 from "../../assets/images/backgrounds/04-zerbrochener-mond.png";
import background05 from "../../assets/images/backgrounds/05-orbitalruinen.png";
import background06 from "../../assets/images/backgrounds/06-eisnebel.png";
import background07 from "../../assets/images/backgrounds/07-sternenwerft.png";
import background08 from "../../assets/images/backgrounds/08-ereignishorizont.png";
import background09 from "../../assets/images/backgrounds/09-doppelsonnen.png";
import background10 from "../../assets/images/backgrounds/10-ionensturm.png";

const BACKGROUNDS = [
  background01,
  background02,
  background03,
  background04,
  background05,
  background06,
  background07,
  background08,
  background09,
  background10,
];

/** Etwas größer als der Viewport, damit die Parallaxe keine Ränder zeigt. */
const OVERSCAN = 1.06;

export class Background {
  private readonly layer: Layer;
  private index = Math.floor(Math.random() * BACKGROUNDS.length);
  texture: Texture;

  constructor(private readonly scene: Scene) {
    this.layer = new Layer("background", null, scene, true);
    this.texture = this.load(BACKGROUNDS[this.index]!);
    scene.getEngine().onResizeObservable.add(() => this.fit());
  }

  /** Wechselt zu einem anderen der Hintergründe; das alte Bild bleibt, bis das neue geladen ist. */
  change(): void {
    this.index = (this.index + 1 + Math.floor(Math.random() * (BACKGROUNDS.length - 1))) % BACKGROUNDS.length;
    this.load(BACKGROUNDS[this.index]!);
  }

  /** Verschiebung als Anteil des Viewports, y nach unten positiv. */
  setScrollOffset(x: number, y: number): void {
    // Clip-Space: 2 Einheiten entsprechen der Viewport-Breite bzw. -Höhe.
    this.layer.offset.set(x * 2, -y * 2);
  }

  private load(url: string): Texture {
    const texture = new Texture(url, this.scene, true, true, Texture.BILINEAR_SAMPLINGMODE, () => {
      if (this.layer.texture !== texture) this.layer.texture?.dispose();
      this.layer.texture = this.texture = texture;
      this.fit();
    });
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    return texture;
  }

  private fit(): void {
    const size = this.texture.getSize();
    if (size.width === 0 || size.height === 0) return;
    const engine = this.scene.getEngine();
    const viewportAspect = engine.getRenderWidth() / engine.getRenderHeight();
    const imageAspect = size.width / size.height;
    const coverScale = imageAspect > viewportAspect ? new Vector2(imageAspect / viewportAspect, 1) : new Vector2(1, viewportAspect / imageAspect);
    this.layer.scale.copyFrom(coverScale).scaleInPlace(OVERSCAN);
  }
}
