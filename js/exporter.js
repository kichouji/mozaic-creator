// PNG の保存とクリップボードへのコピー

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG に変換できませんでした'));
    }, 'image/png');
  });
}

export async function downloadPng(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyPng(canvas) {
  // Blob の Promise を渡すことで、変換中もユーザー操作の扱いが保たれる
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(canvas) })]);
}

/**
 * 保存ファイル名。元のファイル名があれば「元の名前_mosaic.png」、
 * 貼り付けた画像なら「mosaic_YYYYMMDD-HHMMSS.png」。
 */
export function outputFileName(sourceName, now = new Date()) {
  if (sourceName) {
    const base = sourceName.replace(/\.[^.]+$/, '') || 'image';
    return `${base}_mosaic.png`;
  }
  const p = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `mosaic_${date}-${time}.png`;
}
