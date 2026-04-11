'use strict';

import { state, padNames, knob, ps, seq } from './state.js';

const DB_NAME = 'ko-sampler-v1';
const STORE   = 'samples';
const LS_KEY  = 'ko-state';

let db  = null;
let _st = null;

// ── IndexedDB — audio buffers ─────────────────────────────────────────────────

export function openDB() {
  return new Promise(res => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess  = e => { db = e.target.result; res(); };
    req.onerror    = () => res();
  });
}

export function saveSample(bank, pad, arrayBuf) {
  if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(arrayBuf, `${bank}-${pad}`); } catch {}
}

export function deleteSample(bank, pad) {
  if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(`${bank}-${pad}`); } catch {}
}

export function loadAllSamples() {
  return new Promise(res => {
    if (!db) return res([]);
    const out = [];
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = e => {
      const c = e.target.result;
      if (c) { out.push({ key: c.key, buf: c.value }); c.continue(); }
      else res(out);
    };
    req.onerror = () => res([]);
  });
}

// ── localStorage — state snapshot ─────────────────────────────────────────────

export function scheduleSave() {
  clearTimeout(_st);
  _st = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        bank:        state.bank,
        bpm:         state.bpm,
        activeTrack: state.activeTrack,
        padNames:    [...padNames],
        knob:        { ...knob },
        ps: {
          A: ps.A.map(p => ({ ...p })),
          B: ps.B.map(p => ({ ...p })),
          C: ps.C.map(p => ({ ...p })),
        },
        seq: {
          A: seq.A.map(r => [...r]),
          B: seq.B.map(r => [...r]),
          C: seq.C.map(r => [...r]),
        },
      }));
    } catch {}
  }, 1000);
}

export function loadSnapshot() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
