'use strict';

let toastTo;

export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg.toUpperCase();
  t.classList.add('show');
  clearTimeout(toastTo);
  toastTo = setTimeout(() => t.classList.remove('show'), 1400);
}