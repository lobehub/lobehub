import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ABI_FILE = 'apps/desktop/shell/abi.json';

const TRACKED_INPUTS = [
  'apps/desktop/shell',
  'apps/desktop/build',
  'apps/desktop/electron-builder.mjs',
  'apps/desktop/native-deps.config.mjs',
  'apps/desktop/module-deps.config.mjs',
  'apps/desktop/external-runtime-deps.config.mjs',
];
// set-desktop-version copies icon-<channel>.* over these before packaging; the variants stay hashed.
const EXCLUDED =
  /^apps\/desktop\/(?:shell\/(?:abi\.json$|__tests__\/)|build\/(?:icon\.png|icon\.ico|Icon\.icns)$)/;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const stableJson = (value) =>
  value && typeof value === 'object'
    ? `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
        .join(',')}}`
    : JSON.stringify(value);

const gitLsFiles = (root, patterns) =>
  execFileSync('git', ['ls-files', '-z', '--', ...patterns], { cwd: root })
    .toString()
    .split('\0')
    .filter(Boolean);

const lockEntries = (lockText, depNames) => {
  const section = lockText.split(/^packages:\n/m)[1]?.split(/^\S/m)[0] ?? '';
  return section
    .split(/\n(?= {2}\S)/)
    .map((block) => block.trim())
    .filter((block) => {
      const key = block.split('\n')[0].replaceAll(/^'|':?$|:$/g, '');
      return depNames.has(key.slice(0, key.lastIndexOf('@')));
    })
    .sort();
};

export const shellAbiInputs = ({ root = REPO_ROOT, publicKey = '' } = {}) => {
  const read = (file) => fs.readFileSync(path.join(root, file));
  const pkg = JSON.parse(read('apps/desktop/package.json'));
  const nativePackageDirs = gitLsFiles(root, ['packages/*/binding.gyp']).map((file) =>
    path.posix.dirname(file),
  );
  const files = gitLsFiles(root, [...TRACKED_INPUTS, ...nativePackageDirs])
    .filter((file) => !EXCLUDED.test(file))
    .sort();

  return [
    stableJson({
      deps: pkg.dependencies,
      electron: pkg.devDependencies?.electron,
      sandbox: pkg.devDependencies?.['@anthropic-ai/sandbox-runtime'],
    }),
    ...files.map((file) => `${sha256(read(file))}  ${file}`),
    ...lockEntries(
      read('apps/desktop/pnpm-lock.yaml').toString(),
      new Set(Object.keys(pkg.dependencies ?? {})),
    ),
    sha256(publicKey.replaceAll('\r', '').trim()),
  ].join('\n');
};

export const computeShellAbi = (options) => sha256(shellAbiInputs(options));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const publicKey = (process.env.RENDERER_OTA_PUBLIC_KEY ?? '').replaceAll('\r', '').trim();
  const shellAbi = computeShellAbi({ publicKey });
  if (process.argv.includes('--write')) {
    const { version } = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'apps/desktop/package.json'), 'utf8'),
    );
    fs.writeFileSync(
      path.join(REPO_ROOT, ABI_FILE),
      JSON.stringify({ publicKey, shellAbi, shellVersion: version }, null, 2) + '\n',
    );
  }
  console.log(shellAbi);
}
