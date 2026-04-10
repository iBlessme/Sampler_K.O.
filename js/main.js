'use strict';

import { VERSION } from './state.js';
import { initLibrary } from './library.js';
import { buildVU, waveDraw } from './audio.js';
import { buildPads } from './pads.js';
import { buildSeq } from './sequencer.js';
import {
  setupKnobs, setupPsKnobs,
  initContextMenu, initPadSettings, initRename, initFileInput, initExport,
  togglePlay, toggleRecord, changeBpm,
  holdBtn, setBank, toggleMode, nudgePitch,
  initKeyboard,
} from './ui.js';
import { showToast } from './toast.js';

// Global .btn press state — replaces CSS :active to prevent mobile propagation
function initBtnPressState() {
  const clearAll = () => document.querySelectorAll('.btn.pressing').forEach(b => b.classList.remove('pressing'));
  document.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.btn');
    if (btn) btn.classList.add('pressing');
  }, { passive: true });
  document.addEventListener('pointerup',     clearAll, { passive: true });
  document.addEventListener('pointercancel', clearAll, { passive: true });
}

async function init() {
  document.getElementById('brandVersion').textContent = 'v' + VERSION;
  buildPads();
  setupKnobs();
  setupPsKnobs();
  initContextMenu();
  initPadSettings();
  initRename();
  initFileInput();
  initExport();
  await initLibrary();
  initKeyboard();

  holdBtn('btnBpmDown', () => changeBpm(-1));
  holdBtn('btnBpmUp',   () => changeBpm(1));

  buildVU('vuDesktop');
  buildSeq();
  waveDraw('waveCanvas');
  waveDraw('psWaveCanvas');

  document.getElementById('btnPlay').addEventListener('click', togglePlay);
  document.getElementById('btnPlay').addEventListener('touchstart', e => { e.preventDefault(); togglePlay(); }, { passive: false });
  document.getElementById('btnRec').addEventListener('click', toggleRecord);
  document.getElementById('btnRec').addEventListener('touchstart', e => { e.preventDefault(); toggleRecord(); }, { passive: false });

  ['A', 'B', 'C'].forEach(b => {
    const el = document.getElementById('btn' + b);
    el.addEventListener('click', () => setBank(b));
    el.addEventListener('touchstart', e => { e.preventDefault(); setBank(b); }, { passive: false });
  });

  [['btnChop', 'chop'], ['btnLoop', 'loop'], ['btnRev', 'rev']].forEach(([id, m]) => {
    const el = document.getElementById(id);
    el.addEventListener('click', () => toggleMode(m));
    el.addEventListener('touchstart', e => { e.preventDefault(); toggleMode(m); }, { passive: false });
  });

  document.getElementById('pitchDown').addEventListener('touchstart', e => { e.preventDefault(); nudgePitch(-1); }, { passive: false });
  document.getElementById('pitchDown').addEventListener('click', () => nudgePitch(-1));
  document.getElementById('pitchUp').addEventListener('touchstart', e => { e.preventDefault(); nudgePitch(1); }, { passive: false });
  document.getElementById('pitchUp').addEventListener('click', () => nudgePitch(1));

  initBtnPressState();
  showToast('K.O. READY');
}

init();
