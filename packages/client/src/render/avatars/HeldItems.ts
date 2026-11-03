// What an avatar carries: every weapon's shape under the hand node (one enabled at a time) with a
// muzzle flash for its shots, and for a hold weapon its tank on the back and its jet at the nozzle
// while the player is firing (render/Jet.ts); and the gear they wear (render/Gear.ts) on the back,
// with the tank behind it when they have both. Shared by every avatar type so a new item is added
// here once.
import { TransformNode, Vector3, type Mesh } from '@babylonjs/core';
import { ITEMS, ITEM_IDS, type AvatarId, type ItemId } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { WornGear } from '../Gear';
import { coneAngle, createJet, type Jet } from '../Jet';
import { buildFlash, buildTank, buildWeapon, FLASH_SECONDS, holdRoll, weaponPalette } from '../Weapons';

export class HeldItems {
  private readonly weapons = new Map<ItemId, TransformNode>();
  private readonly flashes = new Map<ItemId, Mesh>();
  private readonly tanks = new Map<ItemId, TransformNode>(); // the hold weapons', on the back
  private readonly jets = new Map<ItemId, Jet>(); // and at their nozzles
  private flashLeft = 0;
  private readonly gear: WornGear;
  private readonly backOffset: Vector3;
  private held: ItemId | null = null;
  private lastNow = performance.now();

  // `hand` points the barrel along its local -y when raised (see the avatars), so the shapes,
  // built barrel-along-+z, are turned 90 degrees inside it, and rolled about the barrel as `avatar`
  // holds each.
  constructor(
    engine: Engine,
    name: string,
    avatar: AvatarId,
    hand: TransformNode,
    handOffset: Vector3,
    back: TransformNode,
    backOffset: Vector3,
  ) {
    const scene = engine.scene;
    const pal = weaponPalette(scene, `${name}-weapon`);
    for (const item of ITEM_IDS) {
      const node = new TransformNode(`${name}-${item}`, scene);
      node.parent = hand;
      node.position.copyFrom(handOffset);
      node.rotation.set(Math.PI / 2, 0, holdRoll(avatar, item));
      const muzzle = buildWeapon(scene, `${name}-${item}`, item, node, pal);
      if (!muzzle) {
        node.dispose();
        continue;
      }
      node.setEnabled(false);
      this.weapons.set(item, node);
      this.flashes.set(item, buildFlash(engine, `${name}-${item}`, node, muzzle));
      const spec = ITEMS[item];
      if (!spec.element) continue;
      const nozzle = new TransformNode(`${name}-${item}-nozzle`, scene);
      nozzle.parent = node;
      nozzle.position.copyFrom(muzzle);
      this.jets.set(item, createJet(engine, `${name}-${item}`, nozzle, spec.element, spec.range, coneAngle(spec)));
      const tank = buildTank(scene, `${name}-${item}`, back, pal, spec.element);
      tank.position.copyFrom(backOffset);
      tank.setEnabled(false);
      this.tanks.set(item, tank);
    }
    this.gear = new WornGear(engine, name, back, backOffset);
    this.backOffset = backOffset.clone();
  }

  // Draws the tap weapons `factor` times their size: the player's own, seen from the boom, where true
  // size reads as a toy. A hold weapon keeps its size, its jet drawn from the nozzle at the item's range.
  scaleWeapons(factor: number): void {
    for (const [item, node] of this.weapons) if (ITEMS[item].actions.shoot?.mode === 'tap') node.scaling.setAll(factor);
  }

  update({ item, firing, gear, thrusting }: Pick<RemotePlayer, 'item' | 'firing' | 'gear' | 'thrusting'>): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.gear.update(gear, thrusting, dt);
    if (item !== this.held) {
      if (this.held) {
        this.weapons.get(this.held)?.setEnabled(false);
        this.tanks.get(this.held)?.setEnabled(false);
      }
      if (item) {
        this.weapons.get(item)?.setEnabled(true);
        this.tanks.get(item)?.setEnabled(true);
      }
      this.held = item;
    }
    const tank = item && this.tanks.get(item);
    if (tank) tank.position.z = this.backOffset.z - this.gear.depth;
    for (const [id, jet] of this.jets) {
      jet.set(firing && item === id);
      jet.update(dt);
    }
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      if (this.flashLeft <= 0) for (const flash of this.flashes.values()) flash.setEnabled(false);
    }
  }

  // A tap weapon's shot.
  fire(): void {
    const flash = this.held && this.flashes.get(this.held);
    if (!flash) return;
    flash.setEnabled(true);
    flash.rotation.z = Math.random() * Math.PI;
    this.flashLeft = FLASH_SECONDS;
  }
}
