// トーストと確認ダイアログ

const TOAST_DURATION = 3200;

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  container.append(toast);

  setTimeout(() => {
    toast.classList.add('is-leaving');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, TOAST_DURATION);
}

/**
 * 確認ダイアログを表示し、OK なら true を返す。
 */
export function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
  const dialog = document.getElementById('confirm-dialog');
  const okButton = document.getElementById('confirm-ok');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  okButton.textContent = okLabel;
  okButton.classList.toggle('btn-danger', danger);
  okButton.classList.toggle('btn-primary', !danger);

  dialog.returnValue = '';
  dialog.showModal();
  okButton.focus();

  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

export function isDialogOpen() {
  return document.getElementById('confirm-dialog').open;
}
