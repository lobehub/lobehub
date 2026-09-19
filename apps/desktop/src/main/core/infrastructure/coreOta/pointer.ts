import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isSafeVersion } from './store';

export interface CorePointer {
  abi: string;
  blacklist: string[];
  channel: string | null;
  current: string | null;
  previous: string | null;
  staged: string | null;
}

const versionOrNull = (value: unknown): string | null =>
  typeof value === 'string' && isSafeVersion(value) ? value : null;

export const emptyPointer = (abi: string): CorePointer => ({
  abi,
  blacklist: [],
  channel: null,
  current: null,
  previous: null,
  staged: null,
});

const readRaw = (otaRoot: string) => {
  try {
    return JSON.parse(readFileSync(path.join(otaRoot, 'pointer.json'), 'utf8'));
  } catch {
    return null;
  }
};

export const readPointerAbi = (otaRoot: string): string | null => {
  const abi = readRaw(otaRoot)?.abi;
  return typeof abi === 'string' ? abi : null;
};

export const readPointer = (otaRoot: string, abi: string): CorePointer => {
  const raw = readRaw(otaRoot);
  if (raw?.abi === abi) {
    return {
      abi,
      blacklist: Array.isArray(raw.blacklist) ? raw.blacklist.filter(versionOrNull) : [],
      channel: typeof raw.channel === 'string' ? raw.channel : null,
      current: versionOrNull(raw.current),
      previous: versionOrNull(raw.previous),
      staged: versionOrNull(raw.staged),
    };
  }
  return emptyPointer(abi);
};

export const writePointer = (otaRoot: string, pointer: CorePointer): void => {
  mkdirSync(otaRoot, { mode: 0o700, recursive: true });
  const target = path.join(otaRoot, 'pointer.json');
  writeFileSync(`${target}.tmp`, JSON.stringify(pointer, null, 2));
  renameSync(`${target}.tmp`, target);
};
