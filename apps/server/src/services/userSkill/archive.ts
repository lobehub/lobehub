import { SKILL_INDEX_FILENAME } from '@lobechat/database/schemas';
import type { SkillArchiveFile } from '@lobechat/types';
import { unzipSync, zipSync } from 'fflate';
import { sha256 } from 'js-sha256';

import { namesObjectBuiltIn } from '../skill/packageFiles';

/**
 * A published skill version as one zip: `SKILL.md` at the root and every file
 * beside it at its path — the same layout a sandbox or device unpacks to run
 * the skill's scripts, and what the review reads a version back from.
 */

/**
 * Every entry carries this time, so the same package always zips to the same
 * bytes. Local, because the zip stores local calendar fields: a UTC instant
 * reads as 1979 west of UTC, which the zip refuses.
 */
const fixedMtime = () => new Date(1980, 0, 1);

export interface SkillArchiveEntry {
  /** Text, or the bytes of a binary file. */
  data: string | Uint8Array;
  path: string;
}

/** Zips `SKILL.md` and the files beside it; the hash names the bytes in storage. */
export const packSkillArchive = (skillMd: string, entries: SkillArchiveEntry[]) => {
  const unsafe = entries.find((entry) => namesObjectBuiltIn(entry.path));
  if (unsafe) throw new Error(`Skill file path ${unsafe.path} names an object built-in`);
  const encoder = new TextEncoder();
  const mtime = fixedMtime();
  const tree: Record<string, [Uint8Array, { mtime: Date }]> = {
    [SKILL_INDEX_FILENAME]: [encoder.encode(skillMd), { mtime }],
  };
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    tree[entry.path] = [data, { mtime }];
  }
  const bytes = zipSync(tree);
  return { bytes, hash: sha256(bytes) };
};

/** Reads an archive back as its `SKILL.md` and the files beside it, by path. */
export const unpackSkillArchive = (
  bytes: Uint8Array,
): { content: string; files: SkillArchiveFile[] } => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let content = '';
  const files: SkillArchiveFile[] = [];
  for (const [path, data] of Object.entries(unzipSync(bytes))) {
    if (path.endsWith('/')) continue;
    let text: string | undefined;
    try {
      text = decoder.decode(data);
    } catch {
      // Not UTF-8: a binary file, shown by size rather than as garbled text.
    }
    if (path === SKILL_INDEX_FILENAME) content = text ?? '';
    else
      files.push(
        text === undefined
          ? { binary: true, content: '', path, size: data.length }
          : { content: text, path, size: data.length },
      );
  }
  return { content, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
};
