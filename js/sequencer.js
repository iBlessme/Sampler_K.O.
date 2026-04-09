'use strict';

import { state, seq, N, SPB, BARS, TOTAL } from './state.js';
import { showToast } from './toast.js';
import { hitPad, refreshPadHasSteps } from './pads.js';

export function renderSeq(container, compact) {
  container.innerHTML = '';
  const { bank, activeTrack, activeBar, playing, recording, seqStep } = state;
  const wrap = document.createElement('div');
  wrap.className = 'seq-wrap';

  // top row
  const top = document.createElement('div');
  top.className = 'seq-top-row';

  const lbl = document.createElement('div');
  lbl.className = 'seq-label-text';
  lbl.innerHTML = `seq · <span class="seq-track-name" style="color:var(--orange)">${activeTrack + 1}</span>`;

  const tabs = document.createElement('div');
  tabs.className = 'bar-tabs';
  for (let b = 0; b < BARS; b++) {
    const t = document.createElement('div');
    const barPlay = playing ? Math.floor(seqStep / SPB) : -1;
    t.className = 'bar-tab'
      + (b === activeBar ? ' active' : '')
      + (seq[bank][activeTrack].slice(b * SPB, (b + 1) * SPB).some(Boolean) ? ' has-data' : '')
      + (barPlay === b ? ' current-bar' : '');
    t.textContent = b + 1;
    const bb = b;
    t.addEventListener('touchstart', e => { e.preventDefault(); state.activeBar = bb; buildSeq(); }, { passive: false });
    t.addEventListener('click', () => { state.activeBar = bb; buildSeq(); });
    tabs.appendChild(t);
  }

  const dot = document.createElement('div');
  dot.className = 'seq-mode-dot' + (recording && playing ? ' rec' : playing ? ' play' : recording ? ' rec' : '');

  top.appendChild(lbl); top.appendChild(tabs); top.appendChild(dot);
  wrap.appendChild(top);

  // steps
  const area = document.createElement('div');
  area.className = 'seq-steps-area';
  const off = activeBar * SPB;
  for (let row = 0; row < 2; row++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'seq-row';
    for (let col = 0; col < 8; col++) {
      const gs = off + row * 8 + col;
      const s = document.createElement('div');
      s.className = 'seq-step' + (seq[bank][activeTrack][gs] ? ' on' : '') + (gs === seqStep ? ' current' : '');
      const toggle = e => { e.preventDefault(); seq[bank][activeTrack][gs] ^= true; refreshPadHasSteps(); buildSeq(); };
      s.addEventListener('touchstart', toggle, { passive: false });
      s.addEventListener('mousedown', toggle);
      rowEl.appendChild(s);
    }
    area.appendChild(rowEl);
  }
  wrap.appendChild(area);

  // bar overview — desktop only
  if (!compact) {
    const ov = document.createElement('div');
    ov.className = 'bar-overview';
    for (let b = 0; b < BARS; b++) {
      const mb = document.createElement('div');
      mb.className = 'bar-mini';
      for (let s = 0; s < SPB; s++) {
        const gs = b * SPB + s;
        const ms = document.createElement('div');
        ms.className = 'bar-mini-step' + (seq[bank][activeTrack][gs] ? ' on' : '') + (gs === seqStep ? ' cur' : '');
        mb.appendChild(ms);
      }
      ov.appendChild(mb);
    }
    wrap.appendChild(ov);
  }

  // actions
  const acts = document.createElement('div');
  acts.className = 'seq-actions';
  const btns = compact
    ? [
        ['CLR', () => { seq[bank][activeTrack].fill(false); refreshPadHasSteps(); buildSeq(); showToast('cleared'); }],
        ['RND', () => { const o = state.activeBar * SPB; for (let i = o; i < o + SPB; i++) seq[bank][activeTrack][i] = Math.random() > 0.62; refreshPadHasSteps(); buildSeq(); }],
      ]
    : [
        ['CLR ALL', () => { seq[bank][activeTrack].fill(false); refreshPadHasSteps(); buildSeq(); }],
        ['CLR BAR', () => { const o = state.activeBar * SPB; seq[bank][activeTrack].fill(false, o, o + SPB); refreshPadHasSteps(); buildSeq(); }],
        ['RND',     () => { const o = state.activeBar * SPB; for (let i = o; i < o + SPB; i++) seq[bank][activeTrack][i] = Math.random() > 0.62; refreshPadHasSteps(); buildSeq(); }],
      ];

  btns.forEach(([l, fn]) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.style.cssText = 'flex:1;font-size:7px;padding:4px 0';
    b.textContent = l;
    b.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    b.addEventListener('click', fn);
    acts.appendChild(b);
  });
  wrap.appendChild(acts);
  container.appendChild(wrap);
}

export function buildSeq() {
  const m = document.getElementById('seqMobile');
  const d = document.getElementById('seqDesktop');
  if (m) renderSeq(m, true);
  if (d) renderSeq(d, false);
}

export function tick() {
  state.seqStep = (state.seqStep + 1) % TOTAL;

  // На границе бара — пропускаем пустые бары
  if (state.seqStep % SPB === 0) {
    let checked = 0;
    while (checked < BARS) {
      const off = state.seqStep;
      const hasContent = Array.from({ length: N }).some((_, p) =>
        seq[state.bank][p].slice(off, off + SPB).some(Boolean)
      );
      if (hasContent) break;
      state.seqStep = (state.seqStep + SPB) % TOTAL;
      checked++;
    }
  }

  const pb = Math.floor(state.seqStep / SPB);
  if (pb !== state.activeBar) state.activeBar = pb;
  for (let p = 0; p < N; p++) if (seq[state.bank][p][state.seqStep]) hitPad(p);
  buildSeq();
  const led = document.getElementById('ledPlay');
  led.className = 'led orange';
  setTimeout(() => { led.className = state.playing ? 'led green' : 'led'; }, 70);
}
