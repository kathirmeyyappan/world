// The portal of light a dragon rises through: a pool of pale gold lying on the ground where it
// comes up, with ripples spreading out across it from the middle as over water, thin rings that
// fade as they near the rim; open while the body is still coming out, and fading shut once the
// tail is out. One per dragon, each painting its own pool while it's open.
import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture, type Vector3 } from '@babylonjs/core';
import type { Rise } from './avatars/dragons';
import type { Engine } from './Engine';

const ACROSS = 40; // metres: as wide as Colgera's storm, a pool the whole body comes up through
const FADE = 0.6; // seconds to open or shut
const PIXELS = 512; // across the pool's picture
const STOPS = 256; // samples across the radius the picture is painted from
const REPAINT = 1 / 30; // seconds between paintings of the ripples
const RINGS = 9; // ripples across the radius at once
const RIPPLE_SECONDS = 1.6; // for a ripple to move out by one ring's spacing
const RIPPLE_SHARPNESS = 5; // how thin a ripple's band is: the crest of a cosine to this power
const BORN = 0.12; // the share of the radius a ripple grows in over, from the middle
const GLOW = 0.8; // the pool's own light, in the middle
const RIPPLE = 0.45; // how much a ripple adds, near the middle

export class Portal implements Rise {
  private readonly engine: Engine;
  private readonly disc: Mesh;
  private readonly material: StandardMaterial;
  private readonly picture: DynamicTexture;
  private open = 0; // 0 shut to 1 open
  private time = 0;
  private painted = -Infinity; // the time the ripples were last painted at

  constructor(engine: Engine, name: string) {
    this.engine = engine;
    const scene = engine.scene;
    this.disc = MeshBuilder.CreateDisc(name, { radius: ACROSS / 2, tessellation: 48 }, scene);
    this.disc.rotation.x = Math.PI / 2;
    this.disc.isPickable = false;
    this.picture = new DynamicTexture(`${name}-light`, PIXELS, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    this.picture.hasAlpha = true;
    this.material = new StandardMaterial(name, scene);
    this.material.diffuseTexture = this.picture;
    this.material.opacityTexture = this.picture;
    this.material.emissiveTexture = this.picture;
    this.material.emissiveColor = new Color3(1, 0.95, 0.75);
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.disc.material = this.material;
    this.disc.setEnabled(false);
    engine.glowLayer.addIncludedOnlyMesh(this.disc);
    this.paint();
  }

  // `at` is over where the body comes out (its x and z), `ground` the floor there, and `open`
  // whether any of the body is still down in it.
  update(at: Vector3, ground: number, open: boolean, dt: number): void {
    this.open = Math.max(0, Math.min(1, this.open + ((open ? 1 : -1) * dt) / FADE));
    if (open) this.disc.position.set(at.x, ground + 0.04, at.z);
    this.disc.setEnabled(this.open > 0);
    this.material.alpha = this.open;
    this.disc.scaling.setAll(0.6 + 0.4 * this.open);
    if (this.open === 0) return;
    this.time += dt;
    if (this.time - this.painted >= REPAINT) this.paint();
  }

  // The pool at this moment: its own light, brightest in the middle and gone at the rim, with the
  // ripples over it, each a thin band of brighter light moving outward and fading as it goes.
  private paint(): void {
    this.painted = this.time;
    const ctx = this.picture.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(PIXELS / 2, PIXELS / 2, 0, PIXELS / 2, PIXELS / 2, PIXELS / 2);
    const phase = this.time / RIPPLE_SECONDS;
    for (let i = 0; i <= STOPS; i++) {
      const r = i / STOPS;
      const toRim = 1 - r;
      const glow = GLOW * Math.pow(toRim, 1.4);
      const crest = Math.max(0, Math.cos(2 * Math.PI * (r * RINGS - phase)));
      const ripple = RIPPLE * Math.pow(crest, RIPPLE_SHARPNESS) * Math.pow(toRim, 1.5) * Math.min(1, r / BORN);
      const light = Math.min(1, glow + ripple);
      g.addColorStop(
        r,
        `rgba(255,${Math.round(246 + 9 * ripple)},${Math.round(200 + 55 * ripple)},${light.toFixed(3)})`,
      );
    }
    ctx.clearRect(0, 0, PIXELS, PIXELS);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PIXELS, PIXELS);
    this.picture.update();
  }

  dispose(): void {
    this.engine.glowLayer.removeIncludedOnlyMesh(this.disc);
    this.disc.dispose();
    this.material.dispose();
    this.picture.dispose();
  }
}
