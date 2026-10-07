// Text helpers the widgets share.

// `str`, cut short with an ellipsis to fit `max` pixels in the current font.
export function ellipsis(ctx: CanvasRenderingContext2D, str: string, max: number): string {
  if (ctx.measureText(str).width <= max) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(str.slice(0, mid) + '…').width <= max) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo) + '…';
}
