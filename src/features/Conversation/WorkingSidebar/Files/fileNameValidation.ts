export type FileNameError =
  'empty' | 'exists' | 'invalidChars' | 'reserved' | 'tooLong' | 'whitespace';

export interface SiblingEntry {
  isDirectory: boolean;
  name: string;
}

export interface ValidateFileNameParams {
  /**
   * New entries may name a nested path (`a/b/c.ts`), which creates the missing
   * folders on the way, as in VS Code. Renames never may.
   */
  allowNested: boolean;
  /** macOS and Windows file systems ignore case, so `A.ts` collides with `a.ts`. */
  caseInsensitive: boolean;
  /** The entry's current name, when renaming it. */
  currentName?: string;
  name: string;
  /** Entries already in the target folder. */
  siblings: SiblingEntry[];
}

// Same set the file host refuses on rename, so a name that passes here is not
// bounced by the server for its characters.
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /["*:<>?\\|\u0000-\u001F]/;
const MAX_NAME_BYTES = 255;
const textEncoder = new TextEncoder();

const checkSegment = (segment: string): FileNameError | null => {
  if (segment.trim() === '') return 'empty';
  if (segment !== segment.trim()) return 'whitespace';
  if (segment === '.' || segment === '..') return 'reserved';
  if (INVALID_CHARS.test(segment)) return 'invalidChars';
  if (textEncoder.encode(segment).length > MAX_NAME_BYTES) return 'tooLong';
  return null;
};

/**
 * Client-side check for a name typed into the Files tree (new file / folder,
 * rename). Returns `null` for an acceptable name. Renaming to the current name
 * is acceptable too: the tree treats it as a cancel.
 */
export const validateFileName = ({
  allowNested,
  caseInsensitive,
  currentName,
  name,
  siblings,
}: ValidateFileNameParams): FileNameError | null => {
  if (currentName !== undefined && name === currentName) return null;
  if (name.trim() === '') return 'empty';
  if (name !== name.trim()) return 'whitespace';

  if (name.includes('/') && !allowNested) return 'invalidChars';
  const segments = allowNested ? name.split('/') : [name];
  for (const segment of segments) {
    const error = checkSegment(segment);
    if (error) return error;
  }

  const fold = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
  const [first] = segments;
  // A case-only rename (a.ts → A.ts) is the same entry, not a clash.
  if (currentName !== undefined && fold(first) === fold(currentName)) return null;

  const clash = siblings.find((sibling) => fold(sibling.name) === fold(first));
  if (!clash) return null;
  // `src/new.ts` may go into an existing `src` folder; anything else clashes.
  if (segments.length > 1 && clash.isDirectory) return null;
  return 'exists';
};

/**
 * Finder-style free name for a copy landing in a folder that already holds
 * `name`: `name copy.ext`, then `name copy 2.ext`, …
 */
export const getFreeCopyName = (
  name: string,
  isDirectory: boolean,
  siblings: SiblingEntry[],
  caseInsensitive: boolean,
): string => {
  const fold = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
  const taken = new Set(siblings.map((sibling) => fold(sibling.name)));
  if (!taken.has(fold(name))) return name;

  const dot = isDirectory ? -1 : name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} copy${index === 1 ? '' : ` ${index}`}${ext}`;
    if (!taken.has(fold(candidate))) return candidate;
  }
  return `${stem} copy ${Date.now()}${ext}`;
};
