import { access, readFile } from 'node:fs/promises';

import { createPatch } from 'diff';

interface CodexFileChangeEntry {
  kind?: string;
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

interface CodexFileChangeLineStats {
  linesAdded: number;
  linesDeleted: number;
}

interface CodexTrackedFileChangeEntry extends CodexFileChangeEntry, CodexFileChangeLineStats {}

interface CodexTrackedFileChangeItem extends CodexFileChangeItem, CodexFileChangeLineStats {
  changes?: CodexTrackedFileChangeEntry[];
}

const isCodexFileChangePayload = (
  payload: CodexFileChangePayload,
): payload is Required<CodexFileChangePayload> =>
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

const countPatchLines = (
  previousContent: string,
  nextContent: string,
): CodexFileChangeLineStats => {
  if (previousContent === nextContent) return { linesAdded: 0, linesDeleted: 0 };

  const patch = createPatch('codex-file-change', previousContent, nextContent, '', '');
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

const computeLineStats = async (
  change: CodexFileChangeEntry,
  snapshot?: CodexFileChangeSnapshot,
): Promise<CodexFileChangeLineStats> => {
  const filePath = change.path;
  if (!filePath) return { linesAdded: 0, linesDeleted: 0 };

  const kind = change.kind ?? 'update';
  if (kind === 'rename') return { linesAdded: 0, linesDeleted: 0 };

  const previousContent = snapshot?.content ?? '';
  const current = await readTextFileSnapshot(filePath);
  const nextContent = current.content ?? '';

  if (kind === 'add') {
    if (!current.exists) return { linesAdded: 0, linesDeleted: 0 };
    return countPatchLines('', nextContent);
  }

  if (kind === 'delete' || kind === 'remove') {
    if (!snapshot?.exists) return { linesAdded: 0, linesDeleted: 0 };
    return countPatchLines(previousContent, '');
  }

  if (!snapshot?.exists && !current.exists) return { linesAdded: 0, linesDeleted: 0 };

  return countPatchLines(previousContent, nextContent);
};

export class CodexFileChangeTracker {
  private snapshots = new Map<string, Map<string, CodexFileChangeSnapshot>>();

  async track<T extends CodexFileChangePayload>(payload: T): Promise<T> {
    if (!isCodexFileChangePayload(payload)) return payload;

    const itemId = payload.item.id;
    const changes = payload.item.changes ?? [];

    if (payload.type === 'item.started') {
      const snapshots = new Map<string, CodexFileChangeSnapshot>();

      await Promise.all(
        changes.map(async (change) => {
          if (!change.path || snapshots.has(change.path)) return;
          snapshots.set(change.path, await readTextFileSnapshot(change.path));
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
        const stats = await computeLineStats(
          change,
          change.path ? snapshots.get(change.path) : undefined,
        );

        return {
          ...change,
          ...stats,
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

    return {
      ...payload,
      item: {
        ...payload.item,
        ...totals,
        changes: trackedChanges,
      } satisfies CodexTrackedFileChangeItem,
    };
  }
}
