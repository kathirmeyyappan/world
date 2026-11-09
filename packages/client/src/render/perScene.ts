// Something a renderer draws once and shares, made once for each scene that asks: a texture
// belongs to the scene it was made in (and that scene's WebGL context), so a second scene on
// another canvas (the menu's preview of the player) needs one of its own.
import type { Scene } from '@babylonjs/core';

export function perScene<T>(make: (scene: Scene) => T): (scene: Scene) => T {
  const made = new WeakMap<Scene, T>();
  return (scene) => {
    let it = made.get(scene);
    if (it === undefined) {
      it = make(scene);
      made.set(scene, it);
    }
    return it;
  };
}
