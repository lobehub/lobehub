import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface OtaPointer {
  blacklist: string[];
  current: string | null;
  mainHash: string;
  pendingBootCheck: boolean;
  previous: string | null;
  staged: string | null;
}

export const emptyPointer = (mainHash: string): OtaPointer => ({
  blacklist: [],
  current: null,
  mainHash,
  pendingBootCheck: false,
  previous: null,
  staged: null,
});

export const readPointer = (otaDir: string, mainHash: string): OtaPointer => {
  try {
    const raw = JSON.parse(readFileSync(path.join(otaDir, 'pointer.json'), 'utf8'));
    if (
      raw?.mainHash === mainHash &&
      Array.isArray(raw.blacklist) &&
      (raw.current === null || typeof raw.current === 'string')
    ) {
      return {
        blacklist: raw.blacklist,
        current: raw.current,
        mainHash: raw.mainHash,
        pendingBootCheck: !!raw.pendingBootCheck,
        previous: typeof raw.previous === 'string' ? raw.previous : null,
        staged: typeof raw.staged === 'string' ? raw.staged : null,
      };
    }
  } catch {
    /* missing or corrupt -> fresh pointer */
  }
  return emptyPointer(mainHash);
};

export const writePointer = (otaDir: string, pointer: OtaPointer): void => {
  const target = path.join(otaDir, 'pointer.json');
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(pointer, null, 2));
  renameSync(tmp, target);
};
