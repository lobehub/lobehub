import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { createPatch } from 'diff';

interface CodexFileChangeEntry {
  diffText?: string;
  kind?: string;
  linesAdded?: number;
  linesDeleted?: number;
  path?: string;
}

interface CodexFileChangeSnapshot {
  content?: string;
  exists: boolean;
}

interface CodexFileChangeItem {
  changes?: CodexFileChangeEntry[];
  id?: string;
  type?: string;
}

interface CodexFileChangePayload {
  item?: CodexFileChangeItem;
  type?: string;
}

type CodexFileChangePayloadWithId = CodexFileChangePayload & {
  item: CodexFileChangeItem & { id: string };
};

interface CodexFileChangeLineStats {
  linesAdded: number;
  linesDeleted: number;
}

interface CodexFileChangeDiff extends CodexFileChangeLineStats {
  diffText?: string;
}

type CodexTrackedFileChangeEntry = CodexFileChangeEntry & CodexFileChangeDiff;

interface CodexTrackedFileChangeItem extends CodexFileChangeItem, CodexFileChangeLineStats {
  changes?: CodexTrackedFileChangeEntry[];
  diffText?: string;
}

const isCodexFileChangePayload = (
  payload: CodexFileChangePayload,
): payload is CodexFileChangePayloadWithId =>
  payload?.item?.type === 'file_change' && !!payload.item.id;

const readTextFileSnapshot = async (filePath: string): Promise<CodexFileChangeSnapshot> => {
  try {
    await access(filePath);
  } catch {
    return { exists: false };
  }

  try {
    return {
      content: await readFile(filePath, 'utf8'),
      exists: true,
    };
  } catch {
    return { exists: true };
  }
};

const resolveFilePath = (filePath: string, cwd: string): string =>
  path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

const countPatchLines = (patch: string): CodexFileChangeLineStats => {
  let insideHunk = false;
  let linesAdded = 0;
  let linesDeleted = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      insideHunk = true;
      continue;
    }

    if (!insideHunk) continue;

    if (line.startsWith('+')) {
      linesAdded += 1;
      continue;
    }

    if (line.startsWith('-')) {
      linesDeleted += 1;
    }
  }

  return { linesAdded, linesDeleted };
};

const toGitDiffPath = (prefix: 'a' | 'b', filePath: string): string =>
  filePath.startsWith('/') ? `${prefix}${filePath}` : `${prefix}/${filePath}`;

const createDiffText = (filePath: string, previousContent: string, nextContent: string): string => {
  const patch = createPatch(filePath, previousContent, nextContent, '', '');
  return `diff --git ${toGitDiffPath('a', filePath)} ${toGitDiffPath('b', filePath)}\n${patch}`;
};

const buildFileChangeDiff = (
  filePath: string,
  previousContent: string,
  nextContent: string,
): CodexFileChangeDiff => {
  if (previousContent === nextContent) return { linesAdded: 0, linesDeleted: 0 };

  const diffText = createDiffText(filePath, previousContent, nextContent);

  return {
    ...countPatchLines(diffText),
    diffText,
  };
};

const computeFileChangeDiff = async (
  change: CodexFileChangeEntry,
  cwd: string,
  snapshot?: CodexFileChangeSnapshot,
): Promise<CodexFileChangeDiff> => {
  const filePath = change.path;
  if (!filePath) return { linesAdded: 0, linesDeleted: 0 };

  const kind = change.kind ?? 'update';
  if (kind === 'rename') return { linesAdded: 0, linesDeleted: 0 };

  const resolvedFilePath = resolveFilePath(filePath, cwd);
  const previousContent = snapshot?.content ?? '';
  const current = await readTextFileSnapshot(resolvedFilePath);
  const nextContent = current.content ?? '';

  if (kind === 'add') {
    if (!current.exists) return { linesAdded: 0, linesDeleted: 0 };
    if (current.content === undefined) return { linesAdded: 0, linesDeleted: 0 };
    return buildFileChangeDiff(filePath, '', nextContent);
  }

  if (kind === 'delete' || kind === 'remove') {
    if (!snapshot?.exists) return { linesAdded: 0, linesDeleted: 0 };
    if (snapshot.content === undefined) return { linesAdded: 0, linesDeleted: 0 };
    return buildFileChangeDiff(filePath, previousContent, '');
  }

  // An update diff is only trustworthy when the pre-change file was read successfully.
  // Treating a missing or unreadable snapshot as empty content turns a small edit into a
  // synthetic whole-file addition (for example, +5 lines can be reported as +1205).
  if (!snapshot?.exists || snapshot.content === undefined) {
    return {
      linesAdded: change.linesAdded ?? 0,
      linesDeleted: change.linesDeleted ?? 0,
    };
  }

  if (current.exists && current.content === undefined) return { linesAdded: 0, linesDeleted: 0 };

  return buildFileChangeDiff(filePath, previousContent, nextContent);
};

export class CodexFileChangeTracker {
  private snapshots = new Map<string, Map<string, CodexFileChangeSnapshot>>();

  constructor(private readonly cwd = process.cwd()) {}

  async track<T extends CodexFileChangePayload>(payload: T): Promise<T> {
    if (!isCodexFileChangePayload(payload)) return payload;

    const itemId = payload.item.id;
    const changes = payload.item.changes ?? [];

    if (payload.type === 'item.started') {
      const snapshots = new Map<string, CodexFileChangeSnapshot>();

      await Promise.all(
        changes.map(async (change) => {
          if (!change.path || snapshots.has(change.path)) return;
          snapshots.set(
            change.path,
            await readTextFileSnapshot(resolveFilePath(change.path, this.cwd)),
          );
        }),
      );

      this.snapshots.set(itemId, snapshots);
      return payload;
    }

    if (payload.type !== 'item.completed') return payload;

    const snapshots = this.snapshots.get(itemId);
    this.snapshots.delete(itemId);

    if (!snapshots) return payload;

    const trackedChanges = await Promise.all(
      changes.map(async (change) => {
        const diff = await computeFileChangeDiff(
          change,
          this.cwd,
          change.path ? snapshots.get(change.path) : undefined,
        );

        return {
          ...change,
          ...diff,
        } satisfies CodexTrackedFileChangeEntry;
      }),
    );

    const totals = trackedChanges.reduce<CodexFileChangeLineStats>(
      (acc, change) => ({
        linesAdded: acc.linesAdded + change.linesAdded,
        linesDeleted: acc.linesDeleted + change.linesDeleted,
      }),
      { linesAdded: 0, linesDeleted: 0 },
    );
    const diffText = trackedChanges
      .map((change) => change.diffText)
      .filter((text): text is string => !!text)
      .join('\n');

    return {
      ...payload,
      item: {
        ...payload.item,
        ...(diffText ? { diffText } : {}),
        ...totals,
        changes: trackedChanges,
      } satisfies CodexTrackedFileChangeItem,
    };
  }
}
