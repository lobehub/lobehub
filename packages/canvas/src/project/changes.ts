import type { CanvasProjectFile } from '../validate/types';
import { normalizeCanvasPath } from './path';

export interface CanvasFileWrite {
  content?: string;
  encoding?: 'base64' | 'utf8';
  fileRef?: string;
  path: string;
}

export interface CanvasFileRefWrite {
  fileRef: string;
  path: string;
}

export interface CanvasFileEdit {
  newText: string;
  oldText: string;
  path: string;
}

export interface CanvasChangeSet {
  deletes?: string[];
  edits?: CanvasFileEdit[];
  writes?: CanvasFileWrite[];
}

export type CanvasChangeResult =
  { error: string; ok: false } | { files: CanvasProjectFile[]; ok: true };

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

// Strict tool-calling models fill every schema property, so a plain write arrives with fileRef "".
export const isCanvasFileRefWrite = (write: CanvasFileWrite): write is CanvasFileRefWrite =>
  typeof write.fileRef === 'string' && write.fileRef.length > 0;

// Tool-calling models can omit a required field. Read it defensively so the change set reports
// the missing field by name instead of crashing inside normalizeCanvasPath on `undefined`.
const readPath = (value: unknown): string | undefined => {
  const path = (value as { path?: unknown } | null | undefined)?.path;
  return typeof path === 'string' && path.length > 0 ? path : undefined;
};

export const collectCanvasFileRefs = (changes: CanvasChangeSet): CanvasFileRefWrite[] =>
  (changes.writes ?? [])
    .filter(isCanvasFileRefWrite)
    .flatMap((write) => {
      // A fileRef write with no usable path is refused by applyCanvasChanges; skipping it here
      // keeps this pre-resolution pass from crashing on the missing path first.
      const path = readPath(write);
      return path ? [{ fileRef: write.fileRef, path: normalizeCanvasPath(path) ?? path }] : [];
    });

const countOccurrences = (text: string, search: string) => {
  let count = 0;
  for (let index = text.indexOf(search); index !== -1; index = text.indexOf(search, index + 1)) {
    count += 1;
  }
  return count;
};

export const applyCanvasChanges = (
  base: ReadonlyMap<string, CanvasProjectFile>,
  changes: CanvasChangeSet,
  resolvedFileRefs: ReadonlyMap<string, string | Uint8Array> = new Map(),
): CanvasChangeResult => {
  const files = new Map(base);

  for (const [index, write] of (changes.writes ?? []).entries()) {
    const rawPath = readPath(write);
    if (!rawPath) {
      return {
        error: `writes[${index}] is missing "path": every write must name the file it targets, e.g. "index.html".`,
        ok: false,
      };
    }

    const path = normalizeCanvasPath(rawPath) ?? rawPath;
    if (isCanvasFileRefWrite(write)) {
      const content = resolvedFileRefs.get(write.fileRef);
      if (content === undefined) {
        return {
          error: `"${path}": fileRef "${write.fileRef}" could not be resolved.`,
          ok: false,
        };
      }
      files.set(path, { content, path });
      continue;
    }

    if (write.content === undefined) {
      return { error: `"${path}": provide content or fileRef.`, ok: false };
    }
    let content: string | Uint8Array = write.content;
    if (write.encoding === 'base64') {
      try {
        content = decodeBase64(write.content);
      } catch {
        return { error: `"${rawPath}" is not valid base64.`, ok: false };
      }
    }
    files.set(path, { content, path });
  }

  for (const [index, edit] of (changes.edits ?? []).entries()) {
    const rawPath = readPath(edit);
    if (!rawPath) {
      return {
        error: `edits[${index}] is missing "path": every edit must name the file it targets, e.g. "index.html".`,
        ok: false,
      };
    }
    if (typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') {
      return {
        error: `edits[${index}] needs both "oldText" and "newText" strings.`,
        ok: false,
      };
    }

    const path = normalizeCanvasPath(rawPath) ?? rawPath;
    const file = files.get(path);
    if (!file) return { error: `Cannot edit "${rawPath}": the file does not exist.`, ok: false };
    if (typeof file.content !== 'string') {
      return {
        error: `Cannot edit "${rawPath}": it is a binary file. Write it instead.`,
        ok: false,
      };
    }

    const occurrences = countOccurrences(file.content, edit.oldText);
    if (occurrences !== 1) {
      return {
        error: `Cannot edit "${rawPath}": oldText appears ${occurrences} times; it must appear exactly once. Include more surrounding text.`,
        ok: false,
      };
    }
    files.set(path, { content: file.content.replace(edit.oldText, () => edit.newText), path });
  }

  for (const [index, target] of (changes.deletes ?? []).entries()) {
    if (typeof target !== 'string' || target.length === 0) {
      return {
        error: `deletes[${index}] must be a file path, e.g. "index.html".`,
        ok: false,
      };
    }

    const path = normalizeCanvasPath(target) ?? target;
    if (!files.delete(path)) {
      return { error: `Cannot delete "${target}": the file does not exist.`, ok: false };
    }
  }

  return { files: [...files.values()], ok: true };
};
