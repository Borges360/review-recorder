import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = 'static/vendor';
mkdirSync(vendorDir, { recursive: true });
cpSync(join(repoRoot, 'node_modules/@inteiro/tokens/dist/css/inteiro.css'), join(vendorDir, 'inteiro-tokens.css'));
cpSync(
  join(repoRoot, 'node_modules/@inteiro/design-system/src/components.css'),
  join(vendorDir, 'inteiro-components.css'),
);

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  platform: 'browser',
  logLevel: 'info',
};

const entries = ['background', 'content', 'offscreen', 'sidepanel', 'options', 'request-mic'];
await Promise.all(
  entries.map((name) =>
    esbuild.build({
      ...common,
      entryPoints: [`src/${name}.ts`],
      outfile: `dist/${name}.js`,
    }),
  ),
);

cpSync('static', 'dist', { recursive: true });
