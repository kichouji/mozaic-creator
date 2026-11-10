// 初期化と画面の各部品の接続

import { Editor } from './editor.js';
import { setupLoader, decodeImage, readImageData } from './loader.js';
import { BLOCK_SIZE_DEFAULT, GRAY_LEVELS, TYPE_LABELS } from './mosaic.js';
import { downloadPng, copyPng, outputFileName } from './exporter.js';
import { showToast, confirmDialog, isDialogOpen } from './ui.js';

const MAX_DISPLAY_WIDTH = 960;
const MAX_DISPLAY_HEIGHT_RATIO = 0.7;
const LARGE_IMAGE_EDGE = 10000;

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('file-input'),
  dropOverlay: $('drop-overlay'),
  stage: $('stage'),
  emptyState: $('empty-state'),
  canvas: $('canvas'),
  typeRadios: document.querySelectorAll('input[name="mosaic-type"]'),
  grayRadios: document.querySelectorAll('input[name="gray-level"]'),
  blockSettings: $('block-settings'),
  graySettings: $('gray-settings'),
  blockSize: $('block-size'),
  blockSizeValue: $('block-size-value'),
  undoButton: $('undo-button'),
  redoButton: $('redo-button'),
  regionList: $('region-list'),
  regionEmpty: $('region-empty'),
  regionCount: $('region-count'),
  clearButton: $('clear-button'),
  saveButton: $('save-button'),
  copyButton: $('copy-button'),
  statusFile: $('status-file'),
  statusHint: $('status-hint'),
};

/** 現在の設定。範囲を選択するとその範囲の設定が入り、変更は選択中の範囲に反映される。 */
const settings = { type: 'block', blockSize: BLOCK_SIZE_DEFAULT, gray: 'mid' };
let source = null; // { name: string | null }
let busy = false;

const editor = new Editor(els.canvas, {
  onChange: updateUI,
  getSettings: () => ({ ...settings }),
});

// ---------- 画像の読み込み ----------

setupLoader({
  fileInput: els.fileInput,
  openButtons: document.querySelectorAll('[data-open-file]'),
  dropOverlay: els.dropOverlay,
  onFile: (file, { pasted }) => loadImage(file, pasted),
  onError: (message) => showToast(message, 'error'),
  isBlocked: () => busy || isDialogOpen(),
});

async function loadImage(file, pasted) {
  if (busy) return;
  busy = true;
  try {
    let image;
    try {
      image = await decodeImage(file);
    } catch {
      showToast('画像を読み込めませんでした。ファイルが壊れていないか確認してください。', 'error');
      return;
    }

    if (editor.regions.length > 0) {
      const ok = await confirmDialog({
        title: '画像を置き換えますか？',
        message: '現在の画像と、指定した範囲はすべて破棄されます。',
        okLabel: '置き換える',
        danger: true,
      });
      if (!ok) {
        image.bitmap.close();
        return;
      }
    }

    if (Math.max(image.width, image.height) > LARGE_IMAGE_EDGE) {
      const ok = await confirmDialog({
        title: '大きな画像です',
        message: `この画像は ${image.width.toLocaleString()} × ${image.height.toLocaleString()} px です。\n処理に時間がかかったり、動作が重くなったりする場合があります。読み込みますか？`,
        okLabel: '読み込む',
      });
      if (!ok) {
        image.bitmap.close();
        return;
      }
    }

    let data;
    try {
      data = readImageData(image.bitmap);
    } catch {
      image.bitmap.close();
      showToast('画像が大きすぎるため読み込めませんでした。', 'error');
      return;
    }

    source = { name: pasted ? null : file.name };
    editor.setImage({ ...image, data });
    els.emptyState.hidden = true;
    els.canvas.hidden = false;
    layoutCanvas();
  } finally {
    busy = false;
  }
}

function layoutCanvas() {
  if (!editor.hasImage) return;
  const style = getComputedStyle(els.stage);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const availableWidth = els.stage.clientWidth - padX;
  editor.layout(
    Math.min(MAX_DISPLAY_WIDTH, availableWidth),
    window.innerHeight * MAX_DISPLAY_HEIGHT_RATIO,
  );
}

window.addEventListener('resize', layoutCanvas);

// ---------- ツールバー ----------

for (const radio of els.typeRadios) {
  radio.addEventListener('change', () => {
    settings.type = radio.value;
    onSettingsChanged();
  });
}

for (const radio of els.grayRadios) {
  radio.addEventListener('change', () => {
    settings.gray = radio.value;
    onSettingsChanged();
  });
}

els.blockSize.addEventListener('input', () => {
  settings.blockSize = Number(els.blockSize.value);
  onSettingsChanged({ merge: true });
});
els.blockSize.addEventListener('change', () => editor.endMerge());

function onSettingsChanged(options) {
  editor.applySettings(settings, options);
  syncToolbar();
}

function syncToolbar() {
  for (const radio of els.typeRadios) radio.checked = radio.value === settings.type;
  for (const radio of els.grayRadios) radio.checked = radio.value === settings.gray;
  els.blockSettings.hidden = settings.type !== 'block';
  els.graySettings.hidden = settings.type !== 'gray';
  els.blockSize.value = String(settings.blockSize);
  els.blockSizeValue.textContent = `${settings.blockSize}px`;
}

els.undoButton.addEventListener('click', () => editor.undo());
els.redoButton.addEventListener('click', () => editor.redo());

// ---------- 範囲一覧 ----------

els.regionList.addEventListener('click', (e) => {
  const item = e.target.closest('.region-item');
  if (!item) return;
  const id = Number(item.dataset.id);
  if (e.target.closest('.region-delete')) editor.deleteRegion(id);
  else editor.select(id);
});

els.clearButton.addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'すべての範囲を削除しますか？',
    message: `${editor.regions.length} 件の範囲を削除します。「元に戻す」で取り消せます。`,
    okLabel: '削除する',
    danger: true,
  });
  if (ok) editor.clearAll();
});

function regionLabel(r) {
  return r.type === 'block'
    ? `${TYPE_LABELS.block}・${r.blockSize}px`
    : `${TYPE_LABELS.gray}・${GRAY_LEVELS[r.gray].label}`;
}

function renderRegionList() {
  const items = editor.regions.map((r, i) => {
    const li = document.createElement('li');
    li.className = `region-item${r.id === editor.selectedId ? ' is-selected' : ''}`;
    li.dataset.id = String(r.id);

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'region-main';

    const index = document.createElement('span');
    index.className = 'region-index';
    index.textContent = String(i + 1);

    const swatch = document.createElement('span');
    swatch.className = `region-swatch is-${r.type}`;
    if (r.type === 'gray') swatch.style.background = GRAY_LEVELS[r.gray].color;

    const text = document.createElement('span');
    text.className = 'region-text';
    const title = document.createElement('span');
    title.className = 'region-title';
    title.textContent = regionLabel(r);
    const meta = document.createElement('span');
    meta.className = 'region-meta';
    meta.textContent = `${r.w} × ${r.h} px`;
    text.append(title, meta);

    main.append(index, swatch, text);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'region-delete';
    del.title = '削除';
    del.setAttribute('aria-label', `範囲 ${i + 1} を削除`);
    del.innerHTML =
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

    li.append(main, del);
    return li;
  });
  els.regionList.replaceChildren(...items);
  els.regionList.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
}

// ---------- 画面の更新 ----------

function updateUI() {
  const selected = editor.selected;
  if (selected) {
    settings.type = selected.type;
    settings.blockSize = selected.blockSize;
    settings.gray = selected.gray;
  }
  syncToolbar();

  const has = editor.hasImage;
  const count = editor.regions.length;
  els.undoButton.disabled = !editor.canUndo;
  els.redoButton.disabled = !editor.canRedo;
  els.saveButton.disabled = !has;
  els.copyButton.disabled = !has;
  els.clearButton.disabled = count === 0;
  els.regionCount.textContent = String(count);
  els.regionEmpty.hidden = count > 0;
  renderRegionList();

  if (has) {
    const { width, height } = editor.image;
    const name = source?.name ?? '貼り付けた画像';
    els.statusFile.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = name;
    els.statusFile.append(strong, `　${width.toLocaleString()} × ${height.toLocaleString()} px`);
    els.statusHint.textContent = selected
      ? 'ドラッグで移動・ハンドルでサイズ変更・Delete で削除'
      : 'ドラッグで範囲を追加・クリックで選択';
  }
}

// ---------- 書き出し ----------

async function save() {
  if (!editor.hasImage) return;
  try {
    await downloadPng(editor.exportCanvas(), outputFileName(source?.name));
    showToast('PNG を保存しました', 'success');
  } catch {
    showToast('PNG を保存できませんでした。', 'error');
  }
}

async function copy() {
  if (!editor.hasImage) return;
  try {
    await copyPng(editor.exportCanvas());
    showToast('クリップボードにコピーしました', 'success');
  } catch {
    showToast('クリップボードにコピーできませんでした。', 'error');
  }
}

els.saveButton.addEventListener('click', save);
els.copyButton.addEventListener('click', copy);

// ---------- キーボード操作 ----------

document.addEventListener('keydown', (e) => {
  if (isDialogOpen()) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 's') {
    e.preventDefault();
    save();
  } else if (mod && key === 'z' && !e.shiftKey) {
    e.preventDefault();
    editor.undo();
  } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
    e.preventDefault();
    editor.redo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selected) {
    e.preventDefault();
    editor.deleteSelected();
  } else if (e.key === 'Escape') {
    editor.cancelOrDeselect();
  }
});

// 範囲がある状態でページを離れるときは確認する
window.addEventListener('beforeunload', (e) => {
  if (editor.regions.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

updateUI();
