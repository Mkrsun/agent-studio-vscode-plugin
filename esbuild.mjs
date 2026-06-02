import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

/** @type {import('esbuild').BuildOptions} */
const marketplaceWebviewConfig = {
  entryPoints: ['media/marketplace/marketplace.js'],
  bundle: true,
  outfile: 'dist/marketplace-webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: !production,
  minify: production,
};

async function main() {
  if (watch) {
    const [extCtx, mktCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(marketplaceWebviewConfig),
    ]);
    await Promise.all([extCtx.watch(), mktCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(marketplaceWebviewConfig),
    ]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
