// Downsample an image to a coarse pixel grid. Used for cube faces and the info card so logos
// read as retro sprites rather than photos glued onto geometry. Cached per URL and size.
const cache = new Map<string, Promise<HTMLCanvasElement>>();

export function loadPixelated(url: string, size: number): Promise<HTMLCanvasElement> {
  const key = `${url}@${size}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        const scale = Math.min(size / img.width, size / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    });
    cache.set(key, pending);
  }
  return pending;
}
