import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = path.resolve(DESKTOP_DIR, '../cli');
const RESOURCES_EXCLUDED = new Set(['bin', 'cli-package.json', 'dmg.png', 'locales']);

export function assembleCore({
  cliDir = CLI_DIR,
  desktopDir = DESKTOP_DIR,
  out = path.join(DESKTOP_DIR, 'core-dist'),
} = {}) {
  const inputs = {
    'apps/cli/dist/index.js': path.join(cliDir, 'dist/index.js'),
    'dist/main': path.join(desktopDir, 'dist/main'),
    'dist/preload': path.join(desktopDir, 'dist/preload'),
    'dist/renderer': path.join(desktopDir, 'dist/renderer'),
    'node_modules/electron-log': path.join(desktopDir, 'node_modules/electron-log'),
    'resources': path.join(desktopDir, 'resources'),
  };
  const missing = Object.entries(inputs)
    .filter(([, abs]) => !existsSync(abs))
    .map(([label]) => label);
  if (missing.length) throw new Error(`assembleCore: missing inputs: ${missing.join(', ')}`);

  rmSync(out, { force: true, recursive: true });
  const copy = (from, to, filter) =>
    cpSync(from, path.join(out, to), { dereference: true, filter, recursive: true });

  copy(inputs['dist/main'], 'dist/main');
  copy(inputs['dist/preload'], 'dist/preload');
  copy(inputs['dist/renderer'], 'dist/renderer');
  copy(
    inputs.resources,
    'resources',
    (src) => !RESOURCES_EXCLUDED.has(path.relative(inputs.resources, src).split(path.sep)[0]),
  );
  copy(inputs['node_modules/electron-log'], 'node_modules/electron-log');
  writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }));

  mkdirSync(path.join(out, 'cli'), { recursive: true });
  cpSync(inputs['apps/cli/dist/index.js'], path.join(out, 'cli/lobe-cli.js'));
  const { name, version } = JSON.parse(readFileSync(path.join(cliDir, 'package.json'), 'utf8'));
  writeFileSync(
    path.join(out, 'cli/package.json'),
    JSON.stringify({ name, type: 'module', version }),
  );
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outArg = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
  const out = assembleCore(outArg ? { out: path.resolve(outArg) } : {});
  console.log(`core assembled at ${out}`);
}
