'use strict';

import { VERSION, state, padNames, knob, ps, seq, samples, N, TOTAL } from './state.js';
import { initLibrary } from './library.js';
import { buildVU, waveDraw, ensureCtx, getAudioCtx } from './audio.js';
import { buildPads, refreshPads } from './pads.js';
import { buildSeq } from './sequencer.js';
import {
  setupKnobs, setupPsKnobs, rotK,
  initContextMenu, initPadSettings, initRename, initFileInput, initExport,
  togglePlay, toggleRecord, changeBpm,
  holdBtn, setBank, toggleMode,
  initKeyboard,
} from './ui.js';
import { showToast } from './toast.js';
import { openDB, loadAllSamples, loadSnapshot } from './storage.js';

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

async function restoreFromStorage() {
  await openDB();

  // Restore non-audio state
  const snap = loadSnapshot();
  if (snap) {
    if (snap.padNames) padNames.splice(0, N, ...snap.padNames.slice(0, N));
    if (snap.knob)     Object.assign(knob, snap.knob);
    if (snap.bpm)      state.bpm = snap.bpm;
    if (snap.bank)     state.bank = snap.bank;
    if (snap.activeTrack !== undefined) state.activeTrack = snap.activeTrack;
    if (snap.ps) {
      ['A','B','C'].forEach(b => {
        if (!snap.ps[b]) return;
        snap.ps[b].forEach((p, i) => { if (ps[b][i]) Object.assign(ps[b][i], p); });
      });
    }
    if (snap.seq) {
      ['A','B','C'].forEach(b => {
        if (!snap.seq[b]) return;
        snap.seq[b].forEach((row, i) => {
          if (!seq[b][i]) return;
          row.forEach((v, j) => { if (j < TOTAL) seq[b][i][j] = v; });
        });
      });
    }
  }

  // Restore audio buffers from IndexedDB
  const stored = await loadAllSamples();
  if (stored.length > 0) {
    ensureCtx();
    const ctx = getAudioCtx();
    await Promise.all(stored.map(async ({ key, buf }) => {
      const [bank, padStr] = key.split('-');
      const pad = parseInt(padStr);
      if (!['A','B','C'].includes(bank) || isNaN(pad) || pad < 0 || pad >= N) return;
      try { samples[bank][pad] = await ctx.decodeAudioData(buf.slice(0)); } catch {}
    }));
  }
}

function restoreUI() {
  // Knob visuals
  document.querySelectorAll('.knob').forEach(kn => {
    const label = kn.dataset.label;
    const v = knob[label];
    if (v === undefined) return;
    rotK(kn, v);
    const el = document.getElementById('val' + kn.id.replace('knob', ''));
    if (el) el.textContent = label === 'pitch' ? (v > 50 ? '+' : '') + Math.round(v - 50) : Math.round(v);
  });
  // BPM
  document.getElementById('bpmNum').textContent = state.bpm;
  // Bank buttons
  ['A','B','C'].forEach(b => document.getElementById('btn'+b).classList.toggle('active', b === state.bank));
}

async function init() {
  document.getElementById('brandVersion').textContent = 'v' + VERSION;
  buildPads();
  setupKnobs();
  setupPsKnobs();

  await restoreFromStorage();
  restoreUI();
  refreshPads();
  buildSeq();

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

  initBtnPressState();

  const fsBtn = document.getElementById('btnFullscreen');
  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.classList.toggle('active', !!document.fullscreenElement);
  });

  showToast('K.O. READY');
}

init();
