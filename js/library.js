'use strict';

import { state, samples, padNames, N, lib } from './state.js';
import { ensureCtx, getAudioCtx } from './audio.js';
import { refreshPads } from './pads.js';
import { showToast } from './toast.js';
import { saveSample, scheduleSave } from './storage.js';

const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aac|m4a|aif|aiff|webm)$/i;
const MAX_VISIBLE = 200;

let pendingHandle = null;

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN: загружаем samples/manifest.json и строим паки через fetch()
// ─────────────────────────────────────────────────────────────────────────────

async function loadBuiltin() {
  try {
    const res = await fetch('./samples/manifest.json');
    if (!res.ok) return;
    const manifest = await res.json();                   // { packs: [{name, files:[]}] }
    lib.builtinPacks = manifest.packs.map(pack => ({
      name: pack.name,
      getItems: () => Promise.resolve(
        pack.files
          .filter(f => AUDIO_EXT.test(f))
          .map(fname => ({
            kind: 'file',
            name: fname,
            getFile: async () => {
              const r = await fetch(`./samples/${encodeURIComponent(pack.name)}/${encodeURIComponent(fname)}`);
              const blob = await r.blob();
              return new File([blob], fname, { type: blob.type });
            },
          }))
      ),
    }));
  } catch {
    // нет manifest.json — просто нет встроенных сэмплов
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL: выбор папки с устройства
// Поддерживает два метода:
//   1. File System Access API (Chrome/Brave на https/localhost)
//   2. <input webkitdirectory> — работает везде
// ─────────────────────────────────────────────────────────────────────────────

// IndexedDB — сохраняем FSAPI handle между сессиями
function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ko-sampler', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('data');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}
async function dbGet(key) {
  const db = await getDB();
  return new Promise(r => {
    const req = db.transaction('data', 'readonly').objectStore('data').get(key);
    req.onsuccess = () => r(req.result ?? null);
    req.onerror  = () => r(null);
  });
}
async function dbPut(key, val) {
  const db = await getDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('data', 'readwrite');
    tx.objectStore('data').put(val, key);
    tx.oncomplete = res; tx.onerror = rej;
  });
}

// FSAPI: сканируем директорию → массив паков/файлов
async function scanDirHandle(handle) {
  const packs = [], files = [];
  for await (const [name, h] of handle.entries()) {
    if (h.kind === 'directory') {
      packs.push({
        name,
        getItems: async () => {
          const items = [];
          for await (const [n, fh] of h.entries()) {
            if (fh.kind === 'file' && AUDIO_EXT.test(n))
              items.push({ kind: 'file', name: n, getFile: () => fh.getFile() });
          }
          return items.sort((a, b) => a.name.localeCompare(b.name));
        },
      });
    } else if (AUDIO_EXT.test(name)) {
      files.push({ kind: 'file', name, getFile: () => handle.getFile() });
    }
  }
  packs.sort((a, b) => a.name.localeCompare(b.name));
  if (files.length > 0) {
    packs.unshift({ name: '[ root ]', getItems: () => Promise.resolve(files.sort((a,b)=>a.name.localeCompare(b.name))) });
  }
  return packs;
}

// webkitdirectory: строим структуру из FileList
function buildFromFileList(fileList) {
  const packMap = new Map();
  const rootFiles = [];
  for (const file of fileList) {
    if (!AUDIO_EXT.test(file.name)) continue;
    const parts = file.webkitRelativePath.split('/');
    const item = { kind: 'file', name: file.name, getFile: () => Promise.resolve(file) };
    if (parts.length === 2) {
      rootFiles.push(item);
    } else if (parts.length >= 3) {
      const pack = parts[1];
      if (!packMap.has(pack)) packMap.set(pack, []);
      packMap.get(pack).push(item);
    }
  }
  const packs = [...packMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({
      name,
      getItems: () => Promise.resolve(items.sort((a, b) => a.name.localeCompare(b.name))),
    }));
  if (rootFiles.length > 0) {
    packs.unshift({ name: '[ root ]', getItems: () => Promise.resolve(rootFiles) });
  }
  return packs;
}

// Открытие папки — FSAPI или webkitdirectory
async function pickFolder() {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      lib.localRootName = handle.name;
      lib.localPacks = await scanDirHandle(handle);
      await dbPut('rootDir', handle);
      afterLocalLoaded();
    } catch (e) {
      if (e.name !== 'AbortError') showToast('error opening folder');
    }
  } else {
    document.getElementById('libFolderInput').click();
  }
}

function afterLocalLoaded() {
  document.getElementById('btnLib').classList.add('has-lib');
  switchTab('local');
}

// Восстановление FSAPI handle из IDB
async function tryRestoreHandle() {
  const handle = await dbGet('rootDir');
  if (!handle) return;
  const perm = await handle.queryPermission({ mode: 'read' });
  if (perm === 'granted') {
    lib.localRootName = handle.name;
    lib.localPacks = await scanDirHandle(handle);
    document.getElementById('btnLib').classList.add('has-lib');
  } else if (perm === 'prompt') {
    // Сохраняем handle — покажем кнопку reconnect при открытии библиотеки
    pendingHandle = handle;
  }
}

async function reconnectHandle() {
  if (!pendingHandle) return;
  try {
    const perm = await pendingHandle.requestPermission({ mode: 'read' });
    if (perm === 'granted') {
      lib.localRootName = pendingHandle.name;
      lib.localPacks = await scanDirHandle(pendingHandle);
      pendingHandle = null;
      document.getElementById('btnLib').classList.add('has-lib');
      switchTab('local');
    } else {
      showToast('permission denied');
    }
  } catch {
    showToast('could not reconnect');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  lib.activeTab = tab;
  lib.currentPack = null;
  hidePicker();

  document.getElementById('libTabBuiltin').classList.toggle('active', tab === 'builtin');
  document.getElementById('libTabLocal').classList.toggle('active', tab === 'local');
  document.getElementById('libOpenFolder').style.display = tab === 'local' ? '' : 'none';
  document.getElementById('libLoadKit').style.display = 'none';
  document.getElementById('libRefresh').style.display = tab === 'local' && lib.localPacks.length > 0 ? '' : 'none';

  const showReconnect = tab === 'local' && pendingHandle !== null && lib.localPacks.length === 0;
  document.getElementById('libReconnect').style.display = showReconnect ? '' : 'none';

  setBreadcrumb(null);
  renderPackList(tab === 'builtin' ? lib.builtinPacks : lib.localPacks,
                 tab === 'builtin' ? 'Built-in samples' : lib.localRootName || 'no folder');
}

function renderPackList(packs, rootName) {
  setBreadcrumb(null);
  const el = document.getElementById('libList');
  el.innerHTML = '';

  if (packs.length === 0) {
    el.innerHTML = `<div class="lib-status">${
      lib.activeTab === 'builtin'
        ? 'no built-in samples<br><span style="opacity:.5">add samples/ folder to project</span>'
        : 'click OPEN FOLDER to browse'
    }</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  packs.forEach(pack => {
    const row = document.createElement('div');
    row.className = 'lib-pack-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'lib-item-name';
    nameEl.textContent = '▸  ' + pack.name;
    row.appendChild(nameEl);
    const fn = () => openPack(pack);
    row.addEventListener('click', fn);
    row.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    frag.appendChild(row);
  });
  el.appendChild(frag);
}

async function openPack(pack) {
  document.getElementById('libList').innerHTML = '<div class="lib-status">loading...</div>';
  hidePicker();
  const items = await pack.getItems();
  lib.currentPack = { name: pack.name, items };
  setBreadcrumb(pack.name);
  document.getElementById('libLoadKit').style.display = items.length > 0 ? '' : 'none';
  renderFileList(items);
}

function renderFileList(items) {
  const el = document.getElementById('libList');
  el.innerHTML = '';
  if (items.length === 0) {
    el.innerHTML = '<div class="lib-status">no audio files</div>';
    return;
  }
  const shown = items.slice(0, MAX_VISIBLE);
  const frag  = document.createDocumentFragment();
  shown.forEach(item => {
    const row = document.createElement('div');
    row.className = 'lib-file-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'lib-item-name';
    nameEl.textContent = item.name;
    const arrow = document.createElement('div');
    arrow.className = 'lib-file-arrow';
    arrow.textContent = '→';
    row.appendChild(nameEl);
    row.appendChild(arrow);
    const fn = () => showPadPicker(item);
    row.addEventListener('click', fn);
    row.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    frag.appendChild(row);
  });
  if (items.length > MAX_VISIBLE) {
    const note = document.createElement('div');
    note.className = 'lib-status';
    note.textContent = `first ${MAX_VISIBLE} of ${items.length}`;
    frag.appendChild(note);
  }
  el.appendChild(frag);
}

function setBreadcrumb(packName) {
  const rootEl = document.getElementById('libBcRoot');
  const sepEl  = document.getElementById('libBcSep');
  const packEl = document.getElementById('libBcPack');

  if (lib.activeTab === 'builtin') {
    rootEl.textContent = 'built-in';
  } else {
    rootEl.textContent = lib.localRootName || 'local';
  }

  if (packName) {
    sepEl.style.display  = '';
    packEl.textContent   = packName;
    rootEl.classList.add('lib-bc-link');
  } else {
    sepEl.style.display  = 'none';
    packEl.textContent   = '';
    rootEl.classList.remove('lib-bc-link');
  }
}

// ─── Pad picker ───────────────────────────────────────────────────────────────

function showPadPicker(fileItem) {
  lib.pendingFile = fileItem;
  document.getElementById('libPickerFile').textContent =
    fileItem.name.replace(/\.[^.]+$/, '').slice(0, 22);

  const grid = document.getElementById('libPickerGrid');
  grid.innerHTML = '';
  for (let i = 0; i < N; i++) {
    const btn = document.createElement('div');
    btn.className = 'lib-pad-btn' + (i === state.activeTrack ? ' active' : '');
    btn.textContent = i + 1;
    const fn = () => { loadFileToPad(fileItem, i); hidePicker(); };
    btn.addEventListener('click',      e => { e.stopPropagation(); fn(); });
    btn.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    grid.appendChild(btn);
  }
  document.getElementById('libPadPicker').style.display = 'flex';
  document.getElementById('libPadPicker').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hidePicker() {
  document.getElementById('libPadPicker').style.display = 'none';
  lib.pendingFile = null;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

async function loadFileToPad(fileItem, padIdx) {
  ensureCtx();
  try {
    const file     = await fileItem.getFile();
    const arrayBuf = await file.arrayBuffer();
    saveSample(state.bank, padIdx, arrayBuf.slice(0));
    const buf = await getAudioCtx().decodeAudioData(arrayBuf);
    samples[state.bank][padIdx] = buf;
    padNames[padIdx] = fileItem.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 8);
    refreshPads();
    showToast(`pad ${padIdx + 1} ← ${padNames[padIdx]}`);
    scheduleSave();
  } catch {
    showToast('error loading file');
  }
}

async function loadKit() {
  if (!lib.currentPack || lib.currentPack.items.length === 0) {
    showToast('select a pack first');
    return;
  }
  ensureCtx();
  const toLoad = lib.currentPack.items.filter(x => x.kind === 'file').slice(0, N);
  let loaded = 0;
  for (let i = 0; i < toLoad.length; i++) {
    try {
      const file     = await toLoad[i].getFile();
      const arrayBuf = await file.arrayBuffer();
      saveSample(state.bank, i, arrayBuf.slice(0));
      const buf = await getAudioCtx().decodeAudioData(arrayBuf);
      samples[state.bank][i] = buf;
      padNames[i] = toLoad[i].name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 8);
      loaded++;
    } catch { /* пропускаем битый файл */ }
  }
  refreshPads();
  scheduleSave();
  hidePicker();
  closeLibrary();
  showToast(`kit loaded · ${loaded} pads`);
}

// ─── Open / close overlay ─────────────────────────────────────────────────────

function openLibrary() {
  hidePicker();
  document.getElementById('libOverlay').classList.add('show');
  // При открытии показываем последний активный таб
  switchTab(lib.activeTab);
}

function closeLibrary() {
  document.getElementById('libOverlay').classList.remove('show');
  hidePicker();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initLibrary() {
  // Загружаем встроенные сэмплы и локальный handle параллельно
  await Promise.all([loadBuiltin(), tryRestoreHandle()]);

  // Кнопка LIB
  const btnLib = document.getElementById('btnLib');
  btnLib.addEventListener('click', openLibrary);
  btnLib.addEventListener('touchstart', e => { e.preventDefault(); openLibrary(); }, { passive: false });

  // Закрытие
  document.getElementById('libClose').addEventListener('click', closeLibrary);
  document.getElementById('libOverlay').addEventListener('touchstart', e => {
    if (e.target === document.getElementById('libOverlay')) closeLibrary();
  }, { passive: true });

  // Табы
  document.getElementById('libTabBuiltin').addEventListener('click', () => switchTab('builtin'));
  document.getElementById('libTabBuiltin').addEventListener('touchstart', e => { e.preventDefault(); switchTab('builtin'); }, { passive: false });
  document.getElementById('libTabLocal').addEventListener('click', () => switchTab('local'));
  document.getElementById('libTabLocal').addEventListener('touchstart', e => { e.preventDefault(); switchTab('local'); }, { passive: false });

  // Reconnect
  document.getElementById('libReconnectBtn').addEventListener('click', reconnectHandle);
  document.getElementById('libReconnectBtn').addEventListener('touchstart', e => { e.preventDefault(); reconnectHandle(); }, { passive: false });

  // Открытие папки
  // libOpenFolder intentionally uses only click — iOS Safari blocks input.click() from touchstart
  document.getElementById('libOpenFolder').addEventListener('click', pickFolder);

  // Refresh
  document.getElementById('libRefresh').addEventListener('click', () => switchTab(lib.activeTab));
  document.getElementById('libRefresh').addEventListener('touchstart', e => { e.preventDefault(); switchTab(lib.activeTab); }, { passive: false });

  // Breadcrumb — возврат к списку паков
  document.getElementById('libBcRoot').addEventListener('click', () => {
    if (lib.currentPack) switchTab(lib.activeTab);
  });

  // Load Kit
  document.getElementById('libLoadKit').addEventListener('click', loadKit);
  document.getElementById('libLoadKit').addEventListener('touchstart', e => { e.preventDefault(); loadKit(); }, { passive: false });

  // Pad picker cancel
  document.getElementById('libPickerCancel').addEventListener('click', hidePicker);
  document.getElementById('libPickerCancel').addEventListener('touchstart', e => { e.preventDefault(); hidePicker(); }, { passive: false });

  // webkitdirectory fallback
  document.getElementById('libFolderInput').addEventListener('change', e => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    lib.localRootName = files[0].webkitRelativePath.split('/')[0];
    lib.localPacks = buildFromFileList(files);
    e.target.value = '';
    afterLocalLoaded();
  });
}
