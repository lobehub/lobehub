import { resolve } from 'node:path';

export const ROOT = resolve(__dirname, '../..');
export const DOCS_DIR = resolve(ROOT, 'docs/changelog');
export const CHANGELOG_DIR = resolve(ROOT, 'changelog');
export const CHANGELOG_FILE = {
  v0: resolve(CHANGELOG_DIR, 'CHANGELOG.v0.md'),
  v1: resolve(CHANGELOG_DIR, 'CHANGELOG.v1.md'),
  v2: resolve(ROOT, 'CHANGELOG.md'),
};
export const STATICS_DIR = resolve(DOCS_DIR, '__statics__');
export const CHANGELOG_INDEX = resolve(DOCS_DIR, 'index.json');
