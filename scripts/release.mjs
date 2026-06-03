#!/usr/bin/env node
// =============================================================================
// release.mjs — publish the packaged .vsix to a GitHub Release. Zero deps.
//
// The target repo is NOT hardcoded: it resolves from (highest precedence first)
//   1. CLI flag           --repo <owner/repo>
//   2. env / .env         AGENT_STUDIO_UPDATE_REPO
//   3. built-in default   Mkrsun/agent-studio-vscode-plugin
// so a `.env` (gitignored) decides where releases go — same var the extension's
// self-update reads, so publish target and update source always match.
//
// Usage:
//   node scripts/release.mjs [--repo owner/repo] [--notes <file>] [--dry-run]
//   (needs the `gh` CLI authenticated; reads version from package.json)
// =============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPO = 'Mkrsun/agent-studio-vscode-plugin';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

// --- load .env into process.env (real env wins) ---------------------------------------------------
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const s = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.at(-1) === val[0]) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv(join(ROOT, '.env'));

// --- resolve inputs -------------------------------------------------------------------------------
const repo = arg('--repo', process.env.AGENT_STUDIO_UPDATE_REPO || DEFAULT_REPO);
if (!repo.includes('/')) { console.error(`✗ invalid repo "${repo}" — expected owner/repo`); process.exit(2); }

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const vsix = join(ROOT, 'dist', `agent-studio-${version}.vsix`);
const notes = arg('--notes', join(ROOT, 'RELEASE_NOTES.md'));
const tag = `v${version}`;

if (!existsSync(vsix)) { console.error(`✗ ${vsix} not found — run "npm run package:vsix" first`); process.exit(2); }

const ghArgs = ['release', 'create', tag, vsix, '--repo', repo, '--title', `Agent Studio ${tag}`];
if (existsSync(notes)) ghArgs.push('--notes-file', notes);
else ghArgs.push('--generate-notes');

console.log(`Releasing ${tag} → ${repo}`);
console.log(`  vsix:  ${vsix}`);
console.log(`  notes: ${existsSync(notes) ? notes : '(auto-generated)'}`);
if (has('--dry-run')) { console.log(`\n(dry run) gh ${ghArgs.join(' ')}`); process.exit(0); }

try {
  execFileSync('gh', ghArgs, { stdio: 'inherit' });
  console.log(`\n✓ Released ${tag} to ${repo}`);
} catch (e) {
  console.error(`\n✗ release failed: ${e.message}`);
  process.exit(1);
}
