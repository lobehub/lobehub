import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(desktopRoot));

// Only committed files: this hash must be reproducible from a fresh checkout
// (CI gate/marker jobs) — never include generated files like pnpm-lock.yaml,
// which only exists after install-isolated and would silently be skipped.
export const STANDALONE_FILES = [
  'vite.main.config.ts',
  'vite.preload.config.ts',
  'vite.shared.ts',
  'native-deps.config.mjs',
  'external-runtime-deps.config.mjs',
  'module-deps.config.mjs',
  'electron-builder.mjs',
  'package.json',
];

const IGNORED_DIRS = new Set(['__tests__', '__mocks__', 'node_modules', 'dist']);
const IGNORED_FILE_RE = /\.(?:test|spec)\.[cm]?tsx?$|\.md$|\.snap$/;

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), files);
    } else if (!IGNORED_FILE_RE.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function collectWorkspaceImports(files) {
  const packages = new Set();
  const importRe = /(?:from\s+|import\s*\(\s*|^\s*import\s+)['"]@lobechat\/([\w-]+)/gm;
  for (const file of files) {
    if (!/\.[cm]?tsx?$/.test(file)) continue;
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(importRe)) packages.add(match[1]);
  }
  return packages;
}

function resolveWorkspaceClosure(seedFiles) {
  const resolved = new Set();
  let pending = collectWorkspaceImports(seedFiles);
  while (pending.size > 0) {
    const next = new Set();
    for (const pkg of pending) {
      if (resolved.has(pkg)) continue;
      resolved.add(pkg);
      const srcDir = path.join(repoRoot, 'packages', pkg, 'src');
      try {
        statSync(srcDir);
      } catch {
        continue;
      }
      for (const dep of collectWorkspaceImports(walk(srcDir))) {
        if (!resolved.has(dep)) next.add(dep);
      }
    }
    pending = next;
  }
  return [...resolved].sort();
}

export function computeMainHash() {
  const seedFiles = [
    ...walk(path.join(desktopRoot, 'src', 'main')),
    ...walk(path.join(desktopRoot, 'src', 'preload')),
    ...walk(path.join(desktopRoot, 'src', 'common')),
    ...walk(path.join(desktopRoot, 'resources', 'locales')),
  ];

  const files = [...seedFiles, ...STANDALONE_FILES.map((f) => path.join(desktopRoot, f))];

  for (const pkg of resolveWorkspaceClosure(seedFiles)) {
    files.push(
      ...walk(path.join(repoRoot, 'packages', pkg, 'src')),
      path.join(repoRoot, 'packages', pkg, 'package.json'),
    );
  }

  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    let content;
    try {
      content = readFileSync(file);
    } catch {
      continue;
    }
    if (file === path.join(desktopRoot, 'package.json')) {
      const packageJson = JSON.parse(content.toString());
      delete packageJson.name;
      delete packageJson.productName;
      delete packageJson.version;
      content = Buffer.from(JSON.stringify(packageJson));
    }
    hash.update(path.relative(repoRoot, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  if (process.env.CLOUD_REF) {
    hash.update('cloud-ref\0');
    hash.update(process.env.CLOUD_REF);
    hash.update('\0');
  }
  if (process.env.RENDERER_OTA_PUBLIC_KEY) {
    hash.update('renderer-ota-public-key\0');
    hash.update(process.env.RENDERER_OTA_PUBLIC_KEY);
    hash.update('\0');
  }
  return hash.digest('hex');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(computeMainHash());
}
