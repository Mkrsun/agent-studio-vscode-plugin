import * as vscode from 'vscode';

/**
 * Minimal, zero-dependency `.env` loader.
 *
 * VS Code's extension host only sees the environment it was launched with — it
 * does NOT read a project's `.env`. This loads `.env` files into `process.env`
 * so all AGENT_STUDIO_* overrides (repos, analytics, marketplaces) can live in a
 * gitignored `.env` instead of being baked into settings or the launch env.
 *
 * Precedence: a real, already-set `process.env` value ALWAYS wins (shell/CI env
 * beats the file). Among files, earlier sources win over later ones.
 * Search order: each workspace folder root, then the extension install dir.
 */
export async function loadDotEnv(context: vscode.ExtensionContext): Promise<void> {
  const candidates: vscode.Uri[] = [
    ...(vscode.workspace.workspaceFolders ?? []).map((f) => vscode.Uri.joinPath(f.uri, '.env')),
    vscode.Uri.joinPath(context.extensionUri, '.env'),
  ];

  for (const uri of candidates) {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      continue; // no .env at this location — skip
    }
    for (const [key, value] of parseDotEnv(text)) {
      // Real env (and earlier files) win — never clobber an existing value.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/**
 * Parse `.env` text into [key, value] pairs. Supports `KEY=value`, `export KEY=`,
 * `#` comments, blank lines, and single/double-quoted values (quotes stripped,
 * `\n` unescaped inside double quotes). Unquoted values are trimmed.
 */
export function parseDotEnv(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const stripped = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;

    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = stripped.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    }
    out.push([key, value]);
  }
  return out;
}
