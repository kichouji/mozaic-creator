// 画像の読み込み（ファイル選択／ドラッグ・アンド・ドロップ／クリップボード貼り付け）

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const UNSUPPORTED_MESSAGE = '対応していない形式です。PNG / JPEG / WebP / GIF の画像を指定してください。';

/**
 * @param {object} options
 * @param {HTMLInputElement} options.fileInput
 * @param {Iterable<HTMLElement>} options.openButtons ファイル選択を開くボタン
 * @param {HTMLElement} options.dropOverlay ドラッグ中に表示する要素
 * @param {(file: File, info: {pasted: boolean}) => void} options.onFile
 * @param {(message: string) => void} options.onError
 * @param {() => boolean} [options.isBlocked] true の間は読み込みを受け付けない
 */
export function setupLoader({ fileInput, openButtons, dropOverlay, onFile, onError, isBlocked = () => false }) {
  const accept = (file, pasted) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      onError(UNSUPPORTED_MESSAGE);
      return;
    }
    onFile(file, { pasted });
  };

  // ファイル選択
  for (const button of openButtons) {
    button.addEventListener('click', () => {
      if (!isBlocked()) fileInput.click();
    });
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) accept(file, false);
  });

  // ドラッグ・アンド・ドロップ（ページ全体で受け付ける）
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  let depth = 0;
  const hideOverlay = () => {
    depth = 0;
    dropOverlay.hidden = true;
  };

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (isBlocked()) return;
    depth++;
    dropOverlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isBlocked() ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dropOverlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hideOverlay();
    if (isBlocked()) return;
    const file = e.dataTransfer.files[0];
    if (file) accept(file, false);
  });

  // クリップボード貼り付け
  document.addEventListener('paste', (e) => {
    if (isBlocked()) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items.filter((item) => item.kind === 'file');
    const imageItem = files.find((item) => item.type.startsWith('image/'));
    e.preventDefault();
    if (imageItem) {
      accept(imageItem.getAsFile(), true);
    } else {
      onError(files.length ? UNSUPPORTED_MESSAGE : 'クリップボードに画像がありません。');
    }
  });
}

/** 画像ファイルをデコードする。GIF は1フレーム目になる。 */
export async function decodeImage(file) {
  const bitmap = await createImageBitmap(file);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/** 画像全体の画素を取得する。 */
export function readImageData(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}
