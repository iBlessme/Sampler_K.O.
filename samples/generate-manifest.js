#!/usr/bin/env node
// Запусти: node samples/generate-manifest.js
// Сканирует подпапки в /samples и обновляет manifest.json

const fs   = require('fs');
const path = require('path');

const samplesDir = __dirname;
const audioExt   = /\.(wav|mp3|ogg|flac|aac|m4a|aif|aiff|webm)$/i;

const entries = fs.readdirSync(samplesDir, { withFileTypes: true });
const packs   = [];

for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const packPath = path.join(samplesDir, entry.name);
  const files    = fs.readdirSync(packPath).filter(f => audioExt.test(f)).sort();
  if (files.length > 0) {
    packs.push({ name: entry.name, files });
  }
}

const manifest = { packs };
fs.writeFileSync(
  path.join(samplesDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

console.log(`manifest.json updated: ${packs.length} pack(s)`);
packs.forEach(p => console.log(`  ▸ ${p.name} (${p.files.length} files)`));
