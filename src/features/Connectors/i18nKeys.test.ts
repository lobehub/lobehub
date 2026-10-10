import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import tool from '@/locales/default/tool';

import zhCN from '../../../locales/zh-CN/tool.json';

const collectSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [fullPath];
  });

/**
 * Connector UI calls `t('connector.*', 'English default')` in the `tool` namespace. The inline
 * default hides a missing locale key, so non-English users silently see English text.
 */
const collectConnectorKeys = () => {
  const keys = new Set<string>();
  for (const file of collectSourceFiles(__dirname)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'(connector\.[\w.]+)'/g)) keys.add(match[1]);
  }
  return [...keys].sort();
};

describe('Connectors i18n keys', () => {
  const keys = collectConnectorKeys();

  it('finds connector keys in the feature source', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it('defines every connector key in the default tool locale', () => {
    expect(keys.filter((key) => !(key in tool))).toEqual([]);
  });

  it('ships every connector key in the zh-CN tool locale', () => {
    expect(keys.filter((key) => !(key in zhCN))).toEqual([]);
  });
});
