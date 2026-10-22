// Weltraum-Hintergrund als Fullscreen-Layer hinter der 3D-Szene, der den
// Viewport wie "cover" füllt und sich leicht gegen die Kamera verschiebt.

import { Layer } from "@babylonjs/core/Layers/layer";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import backgroundUrl from "../../assets/images/match_screen_background.png";

/** Etwas größer als der Viewport, damit die Parallaxe keine Ränder zeigt. */
const OVERSCAN = 1.06;

export class Background {
  private readonly layer: Layer;

  constructor(private readonly scene: Scene) {
    this.layer = new Layer("background", null, scene, true);
    this.layer.texture = new Texture(backgroundUrl, scene, true, false, Texture.BILINEAR_SAMPLINGMODE, () => this.fit());
    this.layer.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.layer.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    scene.getEngine().onResizeObservable.add(() => this.fit());
  }

  /** Verschiebung als Anteil des Viewports, y nach unten positiv. */
  setScrollOffset(x: number, y: number): void {
    // Clip-Space: 2 Einheiten entsprechen der Viewport-Breite bzw. -Höhe.
    this.layer.offset.set(x * 2, -y * 2);
  }

  private fit(): void {
    const texture = this.layer.texture;
    if (!texture) return;
    const size = texture.getSize();
    if (size.width === 0 || size.height === 0) return;
    const engine = this.scene.getEngine();
    const viewportAspect = engine.getRenderWidth() / engine.getRenderHeight();
    const imageAspect = size.width / size.height;
    const coverScale =
      imageAspect > viewportAspect
        ? new Vector2(imageAspect / viewportAspect, 1)
        : new Vector2(1, viewportAspect / imageAspect);
    this.layer.scale.copyFrom(coverScale).scaleInPlace(OVERSCAN);
  }
}
