import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

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
