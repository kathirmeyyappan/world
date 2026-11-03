// Streams the world in. Everything heavy that stands somewhere (a region's structure meshes to
// build, a model to fetch) registers here with where it is, and each frame the nearest thing not
// yet begun is begun, so the player is in the world at once and it fills in round them nearest
// first, the far side within a second or two, with no frame spent building more than one thing.
// Nothing waits on distance: a scope sees the far side of the world as sharp as the near, so it
// all comes, only in the order it matters. Fetches overlap a few at a time; a build takes its frame.
const IN_FLIGHT = 3; // fetches running at once

export interface Loadable {
  x: number;
  z: number;
  load: () => void | Promise<void>;
}

export class Loader {
  private readonly pending: Loadable[] = [];
  private fetching = 0;

  add(item: Loadable): void {
    this.pending.push(item);
  }

  // Begins the nearest pending thing to (x, z), if a fetch slot is free. Call once a frame.
  update(x: number, z: number): void {
    if (this.fetching >= IN_FLIGHT || this.pending.length === 0) return;
    let best = 0;
    let bestD = Infinity;
    this.pending.forEach((item, i) => {
      const d = Math.hypot(item.x - x, item.z - z);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    const [item] = this.pending.splice(best, 1);
    const result = item.load();
    if (result) {
      this.fetching++;
      result.catch((e: unknown) => console.error('loading', e)).finally(() => this.fetching--);
    }
  }
}
