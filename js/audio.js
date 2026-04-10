'use strict';

import { state, knob, samples, ps } from './state.js';

const AC = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let masterGain = null;
let reverbImpulse = null;
let mediaRecorder = null;
let recordedChunks = [];

export function ensureCtx() {
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function getAudioCtx() { return audioCtx; }

export function resetReverb() { reverbImpulse = null; }

function getMaster() {
  if (!masterGain) {
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  return masterGain;
}

// ── EXPORT
export function startExport() {
  ensureCtx();
  const dest = audioCtx.createMediaStreamDestination();
  getMaster().connect(dest);
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(dest.stream);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    getMaster().disconnect(dest);
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ko-session-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };
  mediaRecorder.start();
}

export function stopExport() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder = null;
  }
}

export function isExporting() {
  return !!(mediaRecorder && mediaRecorder.state === 'recording');
}

function getRI() {
  if (reverbImpulse) return reverbImpulse;
  const len = audioCtx.sampleRate * 2;
  reverbImpulse = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = reverbImpulse.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
  }
  return reverbImpulse;
}

function sendRev(node, amt) {
  const cv = audioCtx.createConvolver();
  cv.buffer = getRI();
  const g = audioCtx.createGain();
  g.gain.value = amt * 0.6;
  node.connect(cv);
  cv.connect(g);
  g.connect(getMaster());
}

export function playSample(i) {
  ensureCtx();
  const { bank, mode } = state;
  const p = ps[bank][i];
  if (p.mute) return;
  const anySolo = ps[bank].some(x => x.solo);
  if (anySolo && !p.solo) return;
  const buf = samples[bank][i];
  if (!buf) { makeSynth(i); return; }

  const src = audioCtx.createBufferSource();
  if (p.reverse || mode.rev) {
    const r = audioCtx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) r.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
    src.buffer = r;
  } else {
    src.buffer = buf;
  }
  src.loop = p.loop || !!mode.loop;
  src.playbackRate.value = Math.pow(2, (knob.pitch - 50) / 50) * Math.pow(2, (p.pitch - 50) / 50) * Math.pow(2, (p.note - 60) / 12);

  const g = audioCtx.createGain();
  g.gain.value = (knob.vol / 100) * (p.vol / 100);
  const decT = Math.max(0.05, (p.decay / 100) * 2.5);
  g.gain.setValueAtTime(g.gain.value, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + decT);

  const pan = audioCtx.createStereoPanner();
  pan.pan.value = (p.pan - 50) / 50;
  src.connect(g); g.connect(pan); pan.connect(getMaster());
  if (knob.reverb > 5) sendRev(pan, knob.reverb / 100);
  src.start();
  if (src.loop) src.stop(audioCtx.currentTime + 2);
  vuTrig((knob.vol / 100) * (p.vol / 100));
  waveDrawBuf(buf, 'waveCanvas');
}

export function makeSynth(i) {
  ensureCtx();
  const { bank } = state;
  const p = ps[bank][i];
  if (p.mute) return;

  const pp  = Math.pow(2, (knob.pitch - 50) / 50) * Math.pow(2, (p.pitch - 50) / 50) * Math.pow(2, (p.note - 60) / 12);
  const vol = (knob.vol / 100) * (p.vol / 100);
  const atk = Math.max(0.001, knob.attack / 1000);

  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  const pan = audioCtx.createStereoPanner();
  pan.pan.value = (p.pan - 50) / 50;
  const synthType = ['sawtooth', 'square', 'triangle', 'sine'][Math.floor(i / 4) % 4];
  osc.type = synthType;
  osc.frequency.value = [55, 110, 220, 880, 330, 660, 80, 440, 523, 659, 262, 392, 528, 200, 180, 100][i] * pp;
  osc.connect(g); g.connect(pan); pan.connect(getMaster());
  if (knob.reverb > 5) sendRev(pan, knob.reverb / 100);

  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + atk);
  const dur  = [0.1, 0.18, 0.07, 0.12, 0.22, 0.28, 0.45, 0.55, 0.3, 0.3, 0.85, 0.65, 0.7, 0.14, 0.2, 1.0][i];
  const decT = (p.decay / 100) * Math.max(dur, 0.1);

  if (i === 0) {
    osc.frequency.setValueAtTime(150 * pp, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(38 * pp, audioCtx.currentTime + 0.09);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.14);
    osc.start(); osc.stop(audioCtx.currentTime + 0.18);
  } else {
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + decT);
    osc.start(); osc.stop(audioCtx.currentTime + decT + 0.02);
  }
  vuTrig(vol);
  waveDrawSynth(synthType, 'waveCanvas');
}

// ── VU METER
let vuTo = null;

export function buildVU(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const b = document.createElement('div');
    b.className = 'vol-bar';
    b.style.height = '3px';
    m.appendChild(b);
  }
}

export function vuTrig(level) {
  ['vuDesktop'].forEach(id => {
    const bars = document.getElementById(id)?.querySelectorAll('.vol-bar');
    if (!bars) return;
    const n = Math.round(level * 10);
    bars.forEach((b, i) => {
      b.style.height = (i < n ? 4 + (i / (bars.length - 1)) * 14 : 3) + 'px';
      b.className = 'vol-bar' + (i < n ? (i > 9 ? ' clip' : i > 7 ? ' peak' : ' active') : '');
    });
  });
  clearTimeout(vuTo);
  vuTo = setTimeout(() => ['vuDesktop'].forEach(id =>
    document.getElementById(id)?.querySelectorAll('.vol-bar').forEach(b => {
      b.style.height = '3px';
      b.className = 'vol-bar';
    })
  ), 230);
}

// ── WAVEFORM
export function waveDrawBuf(buf, canvasId) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const c    = cv.getContext('2d');
  const data = buf.getChannelData(0);
  const W    = cv.width, H = cv.height;
  const step = Math.max(1, Math.floor(data.length / W));
  c.clearRect(0, 0, W, H);
  c.strokeStyle = '#4ecb71'; c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x < W; x++) {
    const y = H / 2 + (data[x * step] || 0) * (H / 2 - 2);
    x ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.stroke();
}

export function waveDrawSynth(type, canvasId) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = '#4ecb71'; c.lineWidth = 1;
  c.beginPath();
  const cycles = 5;
  for (let x = 0; x < W; x++) {
    const phase = ((x / W) * cycles) % 1;
    let v;
    switch (type) {
      case 'sawtooth': v = phase * 2 - 1; break;
      case 'square':   v = phase < 0.5 ? 0.8 : -0.8; break;
      case 'triangle': v = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4; break;
      default:         v = Math.sin(phase * Math.PI * 2); break;
    }
    const y = H / 2 + v * (H / 2 - 2);
    x ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.stroke();
}

export function waveDraw(id) {
  const cv = document.getElementById(id);
  if (!cv) return;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  c.strokeStyle = '#1a3018'; c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, cv.height / 2);
  c.lineTo(cv.width, cv.height / 2);
  c.stroke();
}
