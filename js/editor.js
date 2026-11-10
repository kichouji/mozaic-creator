// キャンバスの描画と、範囲の作成・選択・移動・リサイズ

import { History } from './history.js';
import { renderRegion, regionKey } from './mosaic.js';

const HANDLE_SIZE = 8; // 表示上の px
const HIT_TOLERANCE = 6; // 表示上の px
const MIN_CREATE_SIZE = 4; // 表示上の px。これ未満の範囲は作成しない
const ACCENT = '#4f46e5';
const DRAFT_ID = 'draft';

const CURSORS = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const rectOf = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const SETTING_KEYS = ['type', 'blockSize', 'gray'];

export class Editor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   * @param {() => void} options.onChange 状態が変わったときに呼ばれる
   * @param {() => {type: string, blockSize: number, gray: string}} options.getSettings 新しい範囲に使う設定
   */
  constructor(canvas, { onChange, getSettings }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.getSettings = getSettings;

    this.image = null; // { bitmap, width, height, data }
    this.regions = []; // { id, x, y, w, h, type, blockSize, gray }（元画像の座標）
    this.selectedId = null;
    this.history = new History();
    this.cache = new Map(); // id -> { key, canvas }
    this.nextId = 1;

    this.scale = 1; // 表示上の px / 元画像の px
    this.dpr = 1;
    this.drag = null;
    this.draft = null;
    this.mergeId = null;
    this.renderPending = false;

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
  }

  // ---------- 状態 ----------

  get hasImage() {
    return this.image !== null;
  }

  get selected() {
    return this.findRegion(this.selectedId);
  }

  get canUndo() {
    return this.history.canUndo && !this.drag;
  }

  get canRedo() {
    return this.history.canRedo && !this.drag;
  }

  findRegion(id) {
    return id == null ? null : this.regions.find((r) => r.id === id) ?? null;
  }

  setImage(image) {
    this.image?.bitmap.close?.();
    this.image = image;
    this.regions = [];
    this.selectedId = null;
    this.history.clear();
    this.cache.clear();
    this.drag = null;
    this.draft = null;
    this.mergeId = null;
    this.notify();
  }

  /** 表示サイズを決める。画像は縦横比を保って最大サイズに収め、拡大はしない。 */
  layout(maxWidth, maxHeight) {
    if (!this.image) return;
    const { width, height } = this.image;
    const fit = Math.min(1, maxWidth / width, maxHeight / height);
    const cssW = Math.max(1, Math.round(width * fit));
    const cssH = Math.max(1, Math.round(height * fit));
    const dpr = window.devicePixelRatio || 1;

    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.scale = cssW / width;
    this.dpr = this.canvas.width / cssW;
    this.render();
  }

  // ---------- 編集操作 ----------

  select(id) {
    if (this.drag) return;
    this.selectedId = this.findRegion(id) ? id : null;
    this.mergeId = null;
    this.notify();
    this.requestRender();
  }

  deleteRegion(id) {
    if (this.drag || !this.findRegion(id)) return;
    this.checkpoint();
    this.regions = this.regions.filter((r) => r.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.notify();
    this.requestRender();
  }

  deleteSelected() {
    if (this.selectedId != null) this.deleteRegion(this.selectedId);
  }

  clearAll() {
    if (this.drag || !this.regions.length) return;
    this.checkpoint();
    this.regions = [];
    this.selectedId = null;
    this.notify();
    this.requestRender();
  }

  /**
   * 選択中の範囲に設定を反映する。
   * merge が true の間（スライダー操作中など）は、連続した変更を1回の履歴にまとめる。
   */
  applySettings(settings, { merge = false } = {}) {
    const r = this.selected;
    if (!r || this.drag) return;
    if (SETTING_KEYS.every((k) => r[k] === settings[k])) return;
    if (!(merge && this.mergeId === r.id)) this.checkpoint();
    this.mergeId = merge ? r.id : null;
    for (const k of SETTING_KEYS) r[k] = settings[k];
    this.notify();
    this.requestRender();
  }

  endMerge() {
    this.mergeId = null;
  }

  undo() {
    if (!this.canUndo) return;
    this.restore(this.history.undo(this.snapshot()));
  }

  redo() {
    if (!this.canRedo) return;
    this.restore(this.history.redo(this.snapshot()));
  }

  /** ドラッグ中なら取り消し、そうでなければ選択を解除する。 */
  cancelOrDeselect() {
    if (this.cancelDrag()) return;
    if (this.selectedId != null) this.select(null);
  }

  cancelDrag() {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    this.draft = null;
    if (d.mode !== 'create' && d.changed) {
      const r = this.findRegion(d.id);
      if (r) Object.assign(r, rectOf(d.orig));
      this.history.discardLast();
    }
    this.notify();
    this.requestRender();
    return true;
  }

  checkpoint() {
    this.history.push(this.snapshot());
    this.mergeId = null;
  }

  snapshot() {
    return { regions: this.regions.map((r) => ({ ...r })), selectedId: this.selectedId };
  }

  restore(state) {
    if (!state) return;
    this.regions = state.regions.map((r) => ({ ...r }));
    this.selectedId = this.findRegion(state.selectedId) ? state.selectedId : null;
    this.mergeId = null;
    this.notify();
    this.requestRender();
  }

  notify() {
    this.onChange?.();
  }

  // ---------- 出力 ----------

  /** 元画像の解像度でモザイクを掛けた画像を返す（枠線などは含まない）。 */
  exportCanvas() {
    const { bitmap, width, height } = this.image;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    for (const r of this.regions) ctx.drawImage(this.regionCanvas(r), r.x, r.y);
    return canvas;
  }

  // ---------- 描画 ----------

  requestRender() {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => this.render());
  }

  render() {
    this.renderPending = false;
    const { ctx, canvas, image } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;

    // 画像とモザイク（元画像の座標系）
    const k = canvas.width / image.width;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.bitmap, 0, 0);
    for (const r of this.regions) ctx.drawImage(this.regionCanvas(r), r.x, r.y);
    if (this.draft) ctx.drawImage(this.regionCanvas(this.draft), this.draft.x, this.draft.y);

    // 枠線とハンドル（表示上の座標系）
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.regions.forEach((r, i) => this.drawFrame(r, i + 1, r.id === this.selectedId));
    if (this.draft) this.drawFrame(this.draft, null, false, true);

    this.pruneCache();
  }

  regionCanvas(r) {
    const key = regionKey(r);
    let entry = this.cache.get(r.id);
    if (!entry || entry.key !== key) {
      entry = { key, canvas: renderRegion(this.image.data, r) };
      this.cache.set(r.id, entry);
    }
    return entry.canvas;
  }

  pruneCache() {
    if (this.cache.size <= this.regions.length + 1) return;
    const ids = new Set(this.regions.map((r) => r.id));
    for (const id of this.cache.keys()) {
      if (id !== DRAFT_ID && !ids.has(id)) this.cache.delete(id);
    }
  }

  drawFrame(r, label, selected, draft = false) {
    const { ctx, scale: s } = this;
    const x = r.x * s;
    const y = r.y * s;
    const w = r.w * s;
    const h = r.h * s;

    ctx.save();
    // 白い縁取りで、どんな背景でも枠線が見えるようにする
    ctx.lineWidth = selected ? 4 : 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeRect(x, y, w, h);

    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.strokeStyle = selected || draft ? ACCENT : 'rgba(79, 70, 229, 0.75)';
    if (draft) ctx.setLineDash([5, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    if (label != null && w >= 26 && h >= 20) {
      const text = String(label);
      ctx.font = '600 11px system-ui, sans-serif';
      const tw = ctx.measureText(text).width;
      const bw = Math.max(18, tw + 10);
      const bx = x + 4;
      const by = y + 4;
      ctx.fillStyle = selected ? ACCENT : 'rgba(23, 26, 33, 0.72)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, 18, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + bw / 2, by + 9.5);
    }

    if (selected) {
      const hs = HANDLE_SIZE;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ACCENT;
      ctx.fillStyle = '#fff';
      for (const [hx, hy] of handlePoints(x, y, w, h)) {
        ctx.beginPath();
        ctx.roundRect(hx - hs / 2, hy - hs / 2, hs, hs, 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------- ポインター操作 ----------

  toImagePoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * this.image.width) / rect.width,
      y: ((e.clientY - rect.top) * this.image.height) / rect.height,
    };
  }

  clampPoint(p) {
    return { x: clamp(p.x, 0, this.image.width), y: clamp(p.y, 0, this.image.height) };
  }

  regionAt(p) {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r;
    }
    return null;
  }

  onPointerDown(e) {
    if (!this.image || e.button !== 0 || this.drag) return;
    e.preventDefault();
    const p = this.toImagePoint(e);
    const sel = this.selected;
    const handle = sel ? hitHandle(sel, p, HIT_TOLERANCE / this.scale) : null;

    if (handle) {
      this.drag = { mode: 'resize', id: sel.id, handle, orig: rectOf(sel), start: p, changed: false };
    } else {
      const hit = this.regionAt(p);
      if (hit) {
        this.selectedId = hit.id;
        this.drag = { mode: 'move', id: hit.id, orig: rectOf(hit), start: p, changed: false };
      } else {
        this.selectedId = null;
        this.drag = { mode: 'create', start: this.clampPoint(p) };
        this.draft = null;
      }
    }
    this.mergeId = null;
    this.canvas.setPointerCapture(e.pointerId);
    this.notify();
    this.requestRender();
  }

  onPointerMove(e) {
    if (!this.image) return;
    const p = this.toImagePoint(e);
    const d = this.drag;
    if (!d) {
      this.updateCursor(p);
      return;
    }

    if (d.mode === 'create') {
      const c = this.clampPoint(p);
      const x0 = Math.round(Math.min(d.start.x, c.x));
      const y0 = Math.round(Math.min(d.start.y, c.y));
      const x1 = Math.round(Math.max(d.start.x, c.x));
      const y1 = Math.round(Math.max(d.start.y, c.y));
      this.draft =
        x1 > x0 && y1 > y0
          ? { ...this.getSettings(), id: DRAFT_ID, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
          : null;
    } else {
      const r = this.findRegion(d.id);
      if (!r) return;
      const next = d.mode === 'move' ? this.movedRect(d, p) : this.resizedRect(d, p);
      if (sameRect(r, next)) return;
      if (!d.changed) {
        this.checkpoint();
        d.changed = true;
      }
      Object.assign(r, next);
    }
    this.requestRender();
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);

    if (d.mode === 'create') {
      const draft = this.draft;
      this.draft = null;
      if (draft && draft.w * this.scale >= MIN_CREATE_SIZE && draft.h * this.scale >= MIN_CREATE_SIZE) {
        this.checkpoint();
        const region = { ...draft, id: this.nextId++ };
        this.regions.push(region);
        this.selectedId = region.id;
        const entry = this.cache.get(DRAFT_ID);
        if (entry) this.cache.set(region.id, entry);
      }
      this.cache.delete(DRAFT_ID);
    }

    this.updateCursor(this.toImagePoint(e));
    this.notify();
    this.requestRender();
  }

  movedRect(d, p) {
    const { orig } = d;
    return {
      x: clamp(Math.round(orig.x + p.x - d.start.x), 0, this.image.width - orig.w),
      y: clamp(Math.round(orig.y + p.y - d.start.y), 0, this.image.height - orig.h),
      w: orig.w,
      h: orig.h,
    };
  }

  resizedRect(d, p) {
    const { orig, handle } = d;
    const { width, height } = this.image;
    let left = orig.x;
    let top = orig.y;
    let right = orig.x + orig.w;
    let bottom = orig.y + orig.h;
    const px = clamp(Math.round(p.x), 0, width);
    const py = clamp(Math.round(p.y), 0, height);

    if (handle.includes('w')) left = px;
    if (handle.includes('e')) right = px;
    if (handle.includes('n')) top = py;
    if (handle.includes('s')) bottom = py;

    let x = Math.min(left, right);
    let y = Math.min(top, bottom);
    let w = Math.abs(right - left);
    let h = Math.abs(bottom - top);
    // 幅・高さは最低 1px
    if (w < 1) {
      w = 1;
      x = Math.min(x, width - 1);
    }
    if (h < 1) {
      h = 1;
      y = Math.min(y, height - 1);
    }
    return { x, y, w, h };
  }

  updateCursor(p) {
    let cursor = 'crosshair';
    const sel = this.selected;
    const handle = sel ? hitHandle(sel, p, HIT_TOLERANCE / this.scale) : null;
    if (handle) cursor = CURSORS[handle];
    else if (this.regionAt(p)) cursor = 'move';
    this.canvas.style.cursor = cursor;
  }
}

function handlePoints(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return [
    [x, y], [cx, y], [x + w, y],
    [x + w, cy], [x + w, y + h], [cx, y + h],
    [x, y + h], [x, cy],
  ];
}

/** 範囲 r のどのハンドル（四隅・各辺）に点 p が当たっているかを返す。 */
function hitHandle(r, p, tol) {
  const l = r.x;
  const t = r.y;
  const rt = r.x + r.w;
  const b = r.y + r.h;
  const near = (a, v) => Math.abs(a - v) <= tol;

  const corners = [
    ['nw', l, t],
    ['ne', rt, t],
    ['se', rt, b],
    ['sw', l, b],
  ];
  for (const [name, x, y] of corners) {
    if (near(p.x, x) && near(p.y, y)) return name;
  }

  const inX = p.x >= l - tol && p.x <= rt + tol;
  const inY = p.y >= t - tol && p.y <= b + tol;
  if (inX && near(p.y, t)) return 'n';
  if (inX && near(p.y, b)) return 's';
  if (inY && near(p.x, l)) return 'w';
  if (inY && near(p.x, rt)) return 'e';
  return null;
}
