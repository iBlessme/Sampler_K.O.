'use strict';

import { state, knob, ps, padNames, samples, seq, defPS, midiName, N } from './state.js';
import { showToast } from './toast.js';
import { ensureCtx, getAudioCtx, resetReverb, waveDrawBuf, waveDraw, startExport, stopExport, isExporting, playSample } from './audio.js';
import { buildSeq, tick } from './sequencer.js';
import { hitPad, refreshPads, buildPads, setOpenCtx } from './pads.js';

// ── UTILITY: touch-and-click binder
function tb(id, fn) {
  const el = document.getElementById(id);
  el.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
  el.addEventListener('click', fn);
}

// ── KNOB HELPERS
export function rotK(k, v) {
  if (k) k.style.transform = `rotate(${-135 + v / 100 * 270}deg)`;
}

function updateKnobDisp(id, label, v) {
  const el = document.getElementById('val' + id.replace('knob', ''));
  if (!el) return;
  el.textContent = label === 'pitch' ? (v > 50 ? '+' : '') + Math.round(v - 50) : Math.round(v);
}

export function setupKnobs() {
  document.querySelectorAll('.knob').forEach(kn => {
    const label = kn.dataset.label;
    let sy = 0, sv = 0;

    function apply(cy) {
      const v = Math.max(0, Math.min(100, sv + (sy - cy) * 0.75));
      knob[label] = v;
      rotK(kn, v);
      updateKnobDisp(kn.id, label, v);
      if (label === 'reverb') resetReverb();
    }

    kn.addEventListener('touchstart', e => {
      e.preventDefault();
      sy = e.touches[0].clientY; sv = knob[label];
      const mv = ev => { ev.preventDefault(); apply(ev.touches[0].clientY); };
      const up = () => { document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', up); };
      document.addEventListener('touchmove', mv, { passive: false });
      document.addEventListener('touchend', up);
    }, { passive: false });

    kn.addEventListener('pointerdown', e => {
      e.preventDefault();
      kn.setPointerCapture(e.pointerId);
      sy = e.clientY; sv = knob[label];
      const mv = ev => apply(ev.clientY);
      const up = () => { kn.removeEventListener('pointermove', mv); kn.removeEventListener('pointerup', up); };
      kn.addEventListener('pointermove', mv);
      kn.addEventListener('pointerup', up);
    });

    rotK(kn, knob[label]);
    updateKnobDisp(kn.id, label, knob[label]);
  });
}

// ── PAD SETTINGS KNOBS
function updatePsVal(k, v) {
  const el = document.getElementById('psVal' + k[0].toUpperCase() + k.slice(1));
  if (!el) return;
  if (k === 'pitch') el.textContent = (v > 50 ? '+' : '') + Math.round(v - 50);
  else if (k === 'pan') el.textContent = v === 50 ? 'C' : (v < 50 ? 'L' + (50 - Math.round(v)) : 'R' + (Math.round(v) - 50));
  else el.textContent = Math.round(v);
}

export function setupPsKnobs() {
  document.querySelectorAll('.ps-knob').forEach(kn => {
    const key = kn.dataset.ps;
    let sy = 0, sv = 0;

    function apply(cy) {
      if (state.psPad === null) return;
      const v = Math.max(0, Math.min(100, sv + (sy - cy) * 0.75));
      ps[state.bank][state.psPad][key] = v;
      rotK(kn, v);
      updatePsVal(key, v);
    }

    kn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (state.psPad === null) return;
      sy = e.touches[0].clientY; sv = ps[state.bank][state.psPad][key];
      const mv = ev => { ev.preventDefault(); apply(ev.touches[0].clientY); };
      const up = () => { document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', up); };
      document.addEventListener('touchmove', mv, { passive: false });
      document.addEventListener('touchend', up);
    }, { passive: false });

    kn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (state.psPad === null) return;
      kn.setPointerCapture(e.pointerId);
      sy = e.clientY; sv = ps[state.bank][state.psPad][key];
      const mv = ev => apply(ev.clientY);
      const up = () => { kn.removeEventListener('pointermove', mv); kn.removeEventListener('pointerup', up); };
      kn.addEventListener('pointermove', mv);
      kn.addEventListener('pointerup', up);
    });
  });
}

// ── CONTEXT MENU
function openCtx(i) {
  state.ctxPad = i;
  document.getElementById('ctxPadName').textContent = padNames[i];
  document.getElementById('ctxPadNum').textContent = i + 1;
  document.getElementById('ctxBankName').textContent = state.bank;
  document.getElementById('ctxCurrentName').textContent = 'Current: ' + padNames[i];
  const tot = seq[state.bank][i].filter(Boolean).length;
  document.getElementById('ctxCopyMeta').textContent = tot ? `${tot} steps across 4 bars` : 'Pattern is empty';
  document.getElementById('ctxPasteMeta').textContent = state.clipboard ? `From ${state.clipboard.fromName}` : 'Nothing copied';
  document.getElementById('ctxRemoveMeta').textContent = samples[state.bank][i] ? 'Revert to synth' : 'No sample loaded';
  document.getElementById('ctxRemoveSample').style.opacity = samples[state.bank][i] ? '1' : '0.4';
  document.getElementById('ctxOverlay').classList.add('show');
}

function closeCtx() {
  document.getElementById('ctxOverlay').classList.remove('show');
  state.ctxPad = null;
}

export function initContextMenu() {
  setOpenCtx(openCtx);

  tb('ctxSettings', () => { const i = state.ctxPad; closeCtx(); setTimeout(() => openPS(i), 100); });
  tb('ctxLoad',     () => { closeCtx(); document.getElementById('fileInput').click(); });
  tb('ctxRename',   () => { const i = state.ctxPad; closeCtx(); setTimeout(() => openRename(i), 150); });
  tb('ctxCopy',     () => {
    if (state.ctxPad === null) return;
    state.clipboard = { steps: [...seq[state.bank][state.ctxPad]], fromName: padNames[state.ctxPad] };
    showToast('copied: ' + padNames[state.ctxPad]);
    closeCtx();
  });
  tb('ctxPaste', () => {
    if (!state.clipboard) { showToast('nothing to paste'); return; }
    seq[state.bank][state.ctxPad] = [...state.clipboard.steps];
    refreshPads(); buildSeq();
    showToast('pasted → ' + padNames[state.ctxPad]);
    closeCtx();
  });
  tb('ctxClearPad', () => {
    seq[state.bank][state.ctxPad].fill(false);
    refreshPads(); buildSeq();
    showToast('cleared all bars');
    closeCtx();
  });
  tb('ctxRemoveSample', () => {
    if (samples[state.bank][state.ctxPad]) {
      delete samples[state.bank][state.ctxPad];
      refreshPads();
      waveDraw('waveCanvas');
    }
    closeCtx();
  });
  tb('ctxCancel', closeCtx);
  document.getElementById('ctxOverlay').addEventListener('touchstart', e => {
    if (e.target === document.getElementById('ctxOverlay')) closeCtx();
  }, { passive: true });
}

// ── PAD SETTINGS
function openPS(i) {
  state.psPad = i;
  const p = ps[state.bank][i];
  document.getElementById('psPadName').textContent = padNames[i];
  document.getElementById('psPadNum').textContent = i + 1;
  document.getElementById('psBankName').textContent = state.bank;
  ['vol', 'pitch', 'pan', 'decay'].forEach(k => {
    const kn = document.getElementById('psKnob' + k[0].toUpperCase() + k.slice(1));
    rotK(kn, p[k]);
    updatePsVal(k, p[k]);
  });
  document.getElementById('psNoteDisplay').textContent = midiName(p.note);
  document.getElementById('psToggleReverse').classList.toggle('active', p.reverse);
  document.getElementById('psToggleLoop').classList.toggle('active', p.loop);
  document.getElementById('psToggleMute').classList.toggle('active', p.mute);
  document.getElementById('psToggleSolo').classList.toggle('active', p.solo);
  const buf = samples[state.bank][i];
  document.getElementById('psWaveSection').style.display = buf ? '' : 'none';
  if (buf) waveDrawBuf(buf, 'psWaveCanvas');
  document.getElementById('padSettingsOverlay').classList.add('show');
}

function closePS() {
  document.getElementById('padSettingsOverlay').classList.remove('show');
  refreshPads();
  state.psPad = null;
}

export function initPadSettings() {
  tb('psNoteDown', () => {
    if (state.psPad === null) return;
    ps[state.bank][state.psPad].note = Math.max(0, ps[state.bank][state.psPad].note - 1);
    document.getElementById('psNoteDisplay').textContent = midiName(ps[state.bank][state.psPad].note);
  });
  tb('psNoteUp', () => {
    if (state.psPad === null) return;
    ps[state.bank][state.psPad].note = Math.min(127, ps[state.bank][state.psPad].note + 1);
    document.getElementById('psNoteDisplay').textContent = midiName(ps[state.bank][state.psPad].note);
  });

  [['psToggleReverse', 'reverse'], ['psToggleLoop', 'loop'], ['psToggleMute', 'mute'], ['psToggleSolo', 'solo']].forEach(([id, k]) => {
    tb(id, () => {
      if (state.psPad === null) return;
      ps[state.bank][state.psPad][k] = !ps[state.bank][state.psPad][k];
      document.getElementById(id).classList.toggle('active', ps[state.bank][state.psPad][k]);
      if (k === 'mute') refreshPads();
    });
  });

  tb('psPlay', () => { if (state.psPad !== null) playSample(state.psPad); });
  tb('psCloseBtn', closePS);
  tb('psClose2', closePS);
  tb('psReset', () => {
    if (state.psPad === null) return;
    ps[state.bank][state.psPad] = defPS();
    openPS(state.psPad);
    showToast('settings reset');
  });

  document.getElementById('padSettingsOverlay').addEventListener('touchstart', e => {
    if (e.target === document.getElementById('padSettingsOverlay')) closePS();
  }, { passive: true });
}

// ── RENAME
function openRename(i) {
  state.renamePad = i;
  document.getElementById('renamePadNum').textContent = i + 1;
  document.getElementById('renameInput').value = padNames[i];
  document.getElementById('renameOverlay').classList.add('show');
  setTimeout(() => document.getElementById('renameInput').focus(), 200);
}

function confirmRename() {
  if (state.renamePad === null) return;
  const v = document.getElementById('renameInput').value.trim().toUpperCase().slice(0, 8);
  if (v) { padNames[state.renamePad] = v; refreshPads(); showToast('renamed → ' + v); }
  document.getElementById('renameOverlay').classList.remove('show');
  state.renamePad = null;
}

export function initRename() {
  tb('renameOk', confirmRename);
  tb('renameCancel', () => document.getElementById('renameOverlay').classList.remove('show'));
  document.getElementById('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmRename(); });
}

// ── FILE LOADING
export function initFileInput() {
  document.getElementById('fileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    ensureCtx();
    const audioCtx = getAudioCtx();
    const target = state.ctxPad !== null ? state.ctxPad : state.activeTrack;
    try {
      const arrayBuf = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = e => res(e.target.result);
        fr.onerror = rej;
        fr.readAsArrayBuffer(file);
      });
      const buf = await audioCtx.decodeAudioData(arrayBuf);
      samples[state.bank][target] = buf;
      // авто-переименование из имени файла
      const autoName = file.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 8);
      if (autoName) padNames[target] = autoName;
      waveDrawBuf(buf, 'waveCanvas');
      if (state.psPad === target) waveDrawBuf(buf, 'psWaveCanvas');
      refreshPads();
      document.getElementById('dispMain').textContent = padNames[target];
      document.getElementById('dispSub').textContent = file.name.slice(0, 14);
      showToast('loaded → ' + padNames[target]);
    } catch {
      showToast('error: bad file');
    }
    e.target.value = '';
    state.ctxPad = null;
  });

  const hint = document.getElementById('loadHint');
  hint.addEventListener('click', () => document.getElementById('fileInput').click());
  hint.addEventListener('touchstart', e => { e.preventDefault(); document.getElementById('fileInput').click(); }, { passive: false });
}

// ── TRANSPORT
export function togglePlay() {
  ensureCtx();
  state.playing = !state.playing;
  const btn = document.getElementById('btnPlay');
  if (state.playing) {
    btn.classList.add('playing');
    btn.textContent = '■';
    document.getElementById('ledPlay').className = 'led green';
    state.seqStep = -1;
    state.activeBar = 0;
    state.seqIv = setInterval(tick, 60000 / state.bpm / 4);
    showToast('playing');
  } else {
    btn.classList.remove('playing');
    btn.textContent = '▶';
    document.getElementById('ledPlay').className = 'led';
    clearInterval(state.seqIv);
    state.seqStep = -1;
    buildSeq();
    showToast('stopped');
  }
  buildSeq();
}

export function toggleRecord() {
  state.recording = !state.recording;
  document.getElementById('btnRec').classList.toggle('recording', state.recording);
  document.getElementById('ledRec').className = state.recording ? 'led red blink' : 'led';
  showToast(state.recording ? 'rec on' : 'rec off');
  buildSeq();
}

export function changeBpm(d) {
  state.bpm = Math.max(40, Math.min(220, state.bpm + d));
  document.getElementById('bpmNum').textContent = state.bpm;
  if (state.playing) {
    clearInterval(state.seqIv);
    state.seqIv = setInterval(tick, 60000 / state.bpm / 4);
  }
}

export function holdBtn(id, fn) {
  const el = document.getElementById(id);
  let iv = null;
  const start = e => { e.preventDefault(); fn(); iv = setInterval(fn, 110); };
  const stop = () => clearInterval(iv);
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', stop);
  el.addEventListener('touchcancel', stop);
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', stop);
  el.addEventListener('mouseleave', stop);
}

export function setBank(b) {
  state.bank = b;
  ['A', 'B', 'C'].forEach(x => document.getElementById('btn' + x).classList.toggle('active', x === b));
  refreshPads();
  buildSeq();
  showToast('bank ' + b);
}

export function toggleMode(m) {
  state.mode[m] = !state.mode[m];
  document.getElementById({ chop: 'btnChop', loop: 'btnLoop', rev: 'btnRev' }[m]).classList.toggle('active', state.mode[m]);
  showToast(m + (state.mode[m] ? ' on' : ' off'));
}

export function nudgePitch(d) {
  knob.pitch = Math.max(0, Math.min(100, knob.pitch + d * 3));
  rotK(document.getElementById('knobPitch'), knob.pitch);
  const el = document.getElementById('valPitch');
  if (el) el.textContent = (knob.pitch > 50 ? '+' : '') + Math.round(knob.pitch - 50);
}

// ── KEYBOARD
export function initKeyboard() {
  const KB = { KeyQ:0, KeyW:1, KeyE:2, KeyR:3, KeyA:4, KeyS:5, KeyD:6, KeyF:7, KeyZ:8, KeyX:9, KeyC:10, KeyV:11, Digit1:12, Digit2:13, Digit3:14, Digit4:15 };
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (document.getElementById('renameOverlay').classList.contains('show')) return;
    if (document.getElementById('padSettingsOverlay').classList.contains('show')) return;
    const i = KB[e.code];
    if (i !== undefined) hitPad(i);
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowUp')   changeBpm(1);
    if (e.key === 'ArrowDown') changeBpm(-1);
    if (e.key === '[') { state.activeBar = Math.max(0, state.activeBar - 1); buildSeq(); }
    if (e.key === ']') { state.activeBar = Math.min(3, state.activeBar + 1); buildSeq(); }
  });
}

// ── EXPORT
export function initExport() {
  const btn = document.getElementById('btnExport');

  function toggle() {
    if (isExporting()) {
      stopExport();
      btn.classList.remove('exporting');
      showToast('export saved');
    } else {
      startExport();
      btn.classList.add('exporting');
      showToast('recording audio...');
    }
  }

  btn.addEventListener('click', toggle);
  btn.addEventListener('touchstart', e => { e.preventDefault(); toggle(); }, { passive: false });
}
