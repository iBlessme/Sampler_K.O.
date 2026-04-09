'use strict';

export const VERSION = '1.0.4';

export const DEFAULT_NAMES = ['KICK','SNARE','HIHAT','CLAP','PERC1','PERC2','BASS','LEAD','FX1','FX2','CHORD','ARP','VOX','NOISE','STAB','LOOP'];
export const PAD_COLORS    = ['#e03535','#e03535','#f4611a','#f4611a','#4ecb71','#4ecb71','#4a9ff4','#4a9ff4','#c47af4','#c47af4','#f4e14a','#f4e14a','#f4611a','#4ecb71','#4a9ff4','#e03535'];
export const NOTES         = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export const N     = 16;
export const BARS  = 4;
export const SPB   = 16;
export const TOTAL = BARS * SPB;

export function midiName(n) { return NOTES[n % 12] + Math.floor(n / 12 - 1); }
export const defPS = () => ({ vol: 100, pitch: 50, pan: 50, decay: 100, note: 60, reverse: false, loop: false, mute: false, solo: false });

const mkSeq = () => Array.from({ length: N }, () => Array(TOTAL).fill(false));

export const state = {
  bank: 'A',
  mode: { chop: false, loop: false, rev: false },
  bpm: 120,
  playing: false,
  recording: false,
  activeTrack: 0,
  activeBar: 0,
  seqStep: -1,
  seqIv: null,
  ctxPad: null,
  psPad: null,
  clipboard: null,
  renamePad: null,
};

export const samples  = { A: {}, B: {}, C: {} };
export const knob     = { vol: 80, pitch: 50, attack: 20, reverb: 0 };
export const padNames = [...DEFAULT_NAMES];
export const ps       = {
  A: Array.from({ length: N }, defPS),
  B: Array.from({ length: N }, defPS),
  C: Array.from({ length: N }, defPS),
};
export const seq = { A: mkSeq(), B: mkSeq(), C: mkSeq() };

export const lib = {
  activeTab: 'builtin',       // 'builtin' | 'local'
  builtinPacks: [],           // [{name, getItems}]
  localPacks: [],             // [{name, getItems}]
  localRootName: '',
  currentPack: null,          // {name, items: [{kind:'file', name, getFile}]}
  pendingFile: null,          // {item, name} — ждёт выбора пэда
};