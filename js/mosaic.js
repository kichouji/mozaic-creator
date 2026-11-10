// モザイク処理（ブロックモザイク／グレー塗りつぶし）

export const BLOCK_SIZE_MIN = 4;
export const BLOCK_SIZE_MAX = 64;
export const BLOCK_SIZE_DEFAULT = 16;

export const GRAY_LEVELS = {
  dark: { label: '濃', color: '#505050' },
  mid: { label: '中', color: '#808080' },
  light: { label: '淡', color: '#b0b0b0' },
};

export const TYPE_LABELS = {
  block: 'ブロック',
  gray: 'グレー',
};

/**
 * 範囲の描画結果を識別するキー。キーが同じなら描画結果も同じ。
 * グレー塗りは位置に依存しないため、位置をキーに含めない。
 */
export function regionKey(r) {
  return r.type === 'gray'
    ? `gray:${r.gray}:${r.w}x${r.h}`
    : `block:${r.blockSize}:${r.x},${r.y}:${r.w}x${r.h}`;
}

/**
 * 範囲 r（元画像の座標）にモザイクを掛けた画像を、範囲と同じ大きさのキャンバスで返す。
 * @param {ImageData} src 元画像全体の画素
 * @param {{x:number,y:number,w:number,h:number,type:string,blockSize:number,gray:string}} r
 */
export function renderRegion(src, r) {
  const canvas = document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const ctx = canvas.getContext('2d');

  if (r.type === 'gray') {
    ctx.fillStyle = (GRAY_LEVELS[r.gray] ?? GRAY_LEVELS.mid).color;
    ctx.fillRect(0, 0, r.w, r.h);
    return canvas;
  }

  const out = ctx.createImageData(r.w, r.h);
  pixelate(src, r, r.blockSize, out);
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/**
 * ブロックモザイク。ブロックの格子は画像の左上を基準にそろえ、
 * 範囲を移動しても格子がずれないようにする。各ブロックは範囲内の画素の平均色で塗る。
 * 透明部分を含む画像に対応するため、色は不透明度で重み付けして平均する。
 */
export function pixelate(src, r, blockSize, out) {
  const sw = src.width;
  const sd = src.data;
  const od = out.data;
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const bs = Math.max(1, Math.round(blockSize));

  for (let by = Math.floor(y0 / bs) * bs; by < y1; by += bs) {
    const ys = Math.max(by, y0);
    const ye = Math.min(by + bs, y1);

    for (let bx = Math.floor(x0 / bs) * bs; bx < x1; bx += bs) {
      const xs = Math.max(bx, x0);
      const xe = Math.min(bx + bs, x1);

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let y = ys; y < ye; y++) {
        let i = (y * sw + xs) * 4;
        for (let x = xs; x < xe; x++, i += 4) {
          const a = sd[i + 3];
          rSum += sd[i] * a;
          gSum += sd[i + 1] * a;
          bSum += sd[i + 2] * a;
          aSum += a;
        }
      }

      const count = (xe - xs) * (ye - ys);
      const cr = aSum ? Math.round(rSum / aSum) : 0;
      const cg = aSum ? Math.round(gSum / aSum) : 0;
      const cb = aSum ? Math.round(bSum / aSum) : 0;
      const ca = Math.round(aSum / count);

      for (let y = ys; y < ye; y++) {
        let o = ((y - y0) * r.w + (xs - x0)) * 4;
        for (let x = xs; x < xe; x++, o += 4) {
          od[o] = cr;
          od[o + 1] = cg;
          od[o + 2] = cb;
          od[o + 3] = ca;
        }
      }
    }
  }
}
