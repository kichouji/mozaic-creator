// 元に戻す／やり直しの履歴（状態のスナップショットを保持する）

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** 変更を加える直前の状態を記録する。 */
  push(state) {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** 1つ前の状態を返す。current はやり直し用に保持する。 */
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }

  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }

  /** 直前の記録を取り消す（操作をキャンセルしたとき用）。 */
  discardLast() {
    this.past.pop();
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
