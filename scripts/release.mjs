#!/usr/bin/env node
// =============================================================================
// release.mjs — publish the packaged .vsix into the repo's update folder (the extension's
// self-update channel reads that folder, not GitHub Releases). Zero deps.
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

const dir = (process.env.AGENT_STUDIO_UPDATE_DIR || 'updates').replace(/^\/+|\/+$/g, '');
const branch = arg('--branch', process.env.AGENT_STUDIO_UPDATE_BRANCH || ''); // '' = repo default branch
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const vsix = join(ROOT, dir, `agent-studio-${version}.vsix`);
const tag = `v${version}`;
const repoPath = `${dir}/agent-studio-${version}.vsix`;

if (!existsSync(vsix)) { console.error(`✗ ${vsix} not found — run "npm run package:vsix" first`); process.exit(2); }

// Publish = commit the .vsix into the repo's update folder (the extension's self-update channel
// reads this folder, not GitHub Releases). Upsert: include the existing blob sha if it's already there.
const refQ = branch ? `?ref=${encodeURIComponent(branch)}` : '';
let sha;
try {
  const cur = JSON.parse(execFileSync('gh', ['api', `/repos/${repo}/contents/${repoPath}${refQ}`], { encoding: 'utf8' }));
  sha = cur.sha;
} catch { /* new file */ }

console.log(`Publishing ${tag} → ${repo}/${repoPath}${branch ? ` (branch ${branch})` : ' (default branch)'}`);
if (has('--dry-run')) { console.log(`\n(dry run) PUT contents/${repoPath}${sha ? ` (update sha ${sha.slice(0, 9)})` : ' (create)'}`); process.exit(0); }

const body = JSON.stringify({
  message: `release: agent-studio ${tag} (self-update channel)`,
  content: readFileSync(vsix).toString('base64'),
  ...(branch ? { branch } : {}),
  ...(sha ? { sha } : {}),
});

try {
  execFileSync('gh', ['api', '-X', 'PUT', `/repos/${repo}/contents/${repoPath}`, '--input', '-'], {
    input: body,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log(`\n✓ Published ${tag} to ${repo}/${repoPath} — installs auto-update within a day (or via "Agent Studio: Check for Updates").`);
} catch (e) {
  console.error(`\n✗ publish failed: ${e.message}`);
  process.exit(1);
}
