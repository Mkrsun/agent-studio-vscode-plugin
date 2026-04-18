#!/usr/bin/env node
/**
 * generate-registry.mjs
 *
 * Scans a marketplace repo's asset directories and emits a `registry.json`
 * index at the repo root. Run from the repo root:
 *
 *   node generate-registry.mjs --id chile --name "Chile"
 *
 * Or copy this script into the marketplace repo and run it there.
 *
 * Directory layout expected:
 *   skills/*.yaml
 *   agents/*.yaml
 *   workflows/*.yaml
 *   instructions/*.yaml
 *   hooks/*.yaml
 *
 * Each YAML file is an asset manifest with `asset.{id,name,version,description,tags,type}`.
 */

import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const ASSET_DIRS = [
  { dir: 'skills', type: 'skill' },
  { dir: 'agents', type: 'agent' },
  { dir: 'workflows', type: 'workflow' },
  { dir: 'instructions', type: 'instruction' },
  { dir: 'hooks', type: 'hook' },
];

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    name: { type: 'string' },
    root: { type: 'string', default: process.cwd() },
  },
});

if (!values.id || !values.name) {
  console.error('Usage: node generate-registry.mjs --id <marketplace-id> --name "<label>" [--root <path>]');
  process.exit(1);
}

const root = values.root;

/** Extract the minimal index fields from a YAML manifest without needing js-yaml. */
function parseManifestFields(text) {
  // We only need id, name, version, description, tags, type from the top-level `asset:` block.
  // Handles simple single-line scalars — enough for generator use.
  const fields = {};
  const lines = text.split(/\r?\n/);
  let inAsset = false;
  let tagsBlock = null;
  for (const line of lines) {
    if (/^asset:\s*$/.test(line)) { inAsset = true; continue; }
    if (!inAsset) continue;
    if (/^\S/.test(line)) break; // left the asset block

    if (tagsBlock !== null) {
      const m = line.match(/^\s{4,}-\s*(.+)$/);
      if (m) { tagsBlock.push(stripQuotes(m[1].trim())); continue; }
      tagsBlock = null;
    }

    const m = line.match(/^\s{2}([a-zA-Z]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    const val = raw.trim();
    if (key === 'tags') {
      if (val === '' || val === '[]') {
        tagsBlock = [];
        fields.tags = tagsBlock;
      } else {
        // Inline tags like [a, b, c]
        fields.tags = val.replace(/^\[|\]$/g, '').split(',').map(s => stripQuotes(s.trim())).filter(Boolean);
      }
      continue;
    }
    if (['id', 'name', 'type', 'version', 'description', 'author'].includes(key)) {
      fields[key] = stripQuotes(val);
    }
  }
  return fields;
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

async function scanDir(typeDef) {
  const abs = join(root, typeDef.dir);
  let entries;
  try {
    entries = await readdir(abs);
  } catch {
    return [];
  }
  const assets = [];
  for (const name of entries) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    const filePath = join(abs, name);
    const s = await stat(filePath);
    if (!s.isFile()) continue;
    const text = await readFile(filePath, 'utf8');
    const fields = parseManifestFields(text);
    if (!fields.id || !fields.type) {
      console.warn(`[skip] ${filePath} — missing id or type`);
      continue;
    }
    if (fields.type !== typeDef.type) {
      console.warn(`[warn] ${filePath} — type ${fields.type} doesn't match folder ${typeDef.dir}`);
    }
    assets.push({
      id: fields.id,
      type: fields.type,
      name: fields.name ?? fields.id,
      version: fields.version ?? '0.0.0',
      description: fields.description ?? '',
      tags: fields.tags ?? [],
      path: relative(root, filePath).replace(/\\/g, '/'),
    });
  }
  return assets;
}

const all = [];
for (const def of ASSET_DIRS) {
  all.push(...(await scanDir(def)));
}
all.sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id));

const registry = {
  schemaVersion: '1.0',
  marketplace: {
    id: values.id,
    name: values.name,
    updatedAt: new Date().toISOString(),
  },
  assets: all,
  plugins: [],
  mcpServers: [],
};

const outPath = join(root, 'registry.json');
await writeFile(outPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outPath} (${all.length} assets)`);
