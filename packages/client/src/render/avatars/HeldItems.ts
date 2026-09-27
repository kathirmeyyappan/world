// What an avatar carries: every item's shape under the hand node (one enabled at a time), the
// flamethrower's tank on the back, and its jet at the nozzle while the player is firing. Shared
// by every avatar type so a new item is added here once.
import { TransformNode, Vector3 } from '@babylonjs/core';
import { ITEMS, ITEM_IDS, type ItemId } from '@world/shared';
import type { Engine } from '../Engine';
import { FlameJet } from '../FlameJet';
import { buildTank, buildWeapon, weaponPalette } from '../Weapons';

export class HeldItems {
  private readonly weapons = new Map<ItemId, TransformNode>();
  private readonly tank: TransformNode;
  private readonly jet: FlameJet;
  private held: ItemId | null = null;
  private lastNow = performance.now();

  // `hand` points the barrel along its local -y when raised (see the avatars), so the shapes,
  // built barrel-along-+z, are turned 90 degrees inside it.
  constructor(engine: Engine, name: string, hand: TransformNode, handOffset: Vector3, back: TransformNode, backOffset: Vector3) {
    const scene = engine.scene;
    const pal = weaponPalette(scene, `${name}-weapon`);
    let nozzle: TransformNode | null = null;
    for (const item of ITEM_IDS) {
      const node = new TransformNode(`${name}-${item}`, scene);
      node.parent = hand;
      node.position.copyFrom(handOffset);
      node.rotation.x = Math.PI / 2;
      const muzzle = buildWeapon(scene, `${name}-${item}`, item, node, pal);
      if (item === 'flamethrower') {
        nozzle = new TransformNode(`${name}-nozzle`, scene);
        nozzle.parent = node;
        nozzle.position.copyFrom(muzzle);
      }
      node.setEnabled(false);
      this.weapons.set(item, node);
    }
    this.tank = buildTank(scene, name, back, pal);
    this.tank.position.copyFrom(backOffset);
    this.tank.setEnabled(false);
    this.jet = new FlameJet(engine, name, nozzle!, ITEMS.flamethrower.range);
  }

  update(item: ItemId | null, firing: boolean): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (item !== this.held) {
      if (this.held) this.weapons.get(this.held)!.setEnabled(false);
      if (item) this.weapons.get(item)!.setEnabled(true);
      this.tank.setEnabled(item === 'flamethrower');
      this.held = item;
    }
    this.jet.set(firing && item === 'flamethrower');
    this.jet.update(dt);
  }
}
