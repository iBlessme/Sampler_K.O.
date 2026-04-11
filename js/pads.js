'use strict';

import { state, samples, ps, seq, padNames, PAD_COLORS, N } from './state.js';
import { playSample } from './audio.js';
import { buildSeq } from './sequencer.js';

const LONG = 620;

export function buildPads() {
  const grid = document.getElementById('padGrid');
  grid.innerHTML = '';
  for (let i = 0; i < N; i++) {
    const pad = document.createElement('div');
    pad.className = 'pad';
    pad.dataset.index = i;
    pad.innerHTML = `
      <div class="pad-num">${i + 1}</div>
      <div class="pad-indicator" style="background:${PAD_COLORS[i]}"></div>
      <div class="pad-glow"></div>
      <div class="pad-name">${padNames[i]}</div>
    `;
    setupLongPress(pad, i, () => openCtxExternal(i));
    pad.addEventListener('touchstart', e => { e.preventDefault(); hitPad(i, pad); }, { passive: false });
    pad.addEventListener('mousedown', e => { if (e.button !== 0) return; e.preventDefault(); hitPad(i, pad); });
    pad.addEventListener('contextmenu', e => { e.preventDefault(); openCtxExternal(i); });
    grid.appendChild(pad);
  }
  refreshPads();
}

// Injected by ui.js to avoid circular dep with context menu
let openCtxExternal = () => {};
export function setOpenCtx(fn) { openCtxExternal = fn; }

function setupLongPress(pad, idx, cb) {
  let t = null, fired = false;

  function start() {
    fired = false;
    t = setTimeout(() => { fired = true; cb(); }, LONG);
  }
  function cancel() {
    clearTimeout(t);
  }

  pad.addEventListener('touchstart', start, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev => pad.addEventListener(ev, cancel, { passive: true }));
  pad.addEventListener('mousedown', start);
  pad.addEventListener('mouseup', cancel);
  pad.addEventListener('mouseleave', cancel);
}

export function hitPad(i, el) {
  if (!el) el = document.querySelector(`.pad[data-index="${i}"]`);
  el.classList.add('hitting');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('hitting'), 130);
  playSample(i);
  if (state.recording) {
    const s = state.seqStep >= 0 ? state.seqStep : 0;
    seq[state.bank][i][s] = true;
    refreshPadHasSteps();
  }
  state.activeTrack = i;
  document.querySelectorAll('.seq-track-name').forEach(x => x.textContent = i + 1);
  document.getElementById('dispMain').textContent = padNames[i];
  document.getElementById('dispSub').textContent = samples[state.bank][i] ? 'sample' : 'synth';
  buildSeq();
}

export function refreshPads() {
  document.querySelectorAll('.pad').forEach((p, i) => {
    p.classList.toggle('has-sample', !!samples[state.bank][i]);
    p.querySelector('.pad-name').textContent = padNames[i];
    p.classList.toggle('muted', ps[state.bank][i].mute);
    p.style.opacity = ps[state.bank][i].mute ? '0.4' : '1';
  });
  refreshPadHasSteps();
}

export function refreshPadHasSteps() {
  document.querySelectorAll('.pad').forEach((p, i) =>
    p.classList.toggle('has-steps', seq[state.bank][i].some(Boolean))
  );
}
