import type { AssistantContentBlock, ChatToolPayloadWithResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  collectFileEditToolCallRecords,
  deriveOperationEditedFiles,
  summarizeEditedFilesTotals,
} from './deriveEditedFiles';

/** Build a display tool payload with a resolved plugin state (result.state). */
const tool = (
  partial: Partial<ChatToolPayloadWithResult> & { apiName: string; id: string },
): ChatToolPayloadWithResult => ({
  arguments: '{}',
  identifier: 'lobe-cloud-sandbox',
  type: 'builtin',
  ...partial,
});

const block = (tools: ChatToolPayloadWithResult[]): AssistantContentBlock => ({
  content: '',
  id: `block-${Math.random()}`,
  tools,
});

const sandboxWrite = (id: string, path: string) =>
  tool({
    apiName: 'writeFile',
    arguments: JSON.stringify({ path }),
    id,
    result: { content: '', id: `${id}-r`, state: { path, success: true } },
  });

const sandboxEdit = (
  id: string,
  path: string,
  deltas: { diffText?: string; linesAdded?: number; linesDeleted?: number } = {},
) =>
  tool({
    apiName: 'editFile',
    arguments: JSON.stringify({ path }),
    id,
    result: { content: '', id: `${id}-r`, state: { path, ...deltas } },
  });

describe('collectFileEditToolCallRecords', () => {
  it('flattens block tools into scanner records, surfacing result.state', () => {
    const records = collectFileEditToolCallRecords([
      block([sandboxWrite('t1', '/work/a.ts')]),
      block([sandboxEdit('t2', '/work/a.ts', { linesAdded: 2 })]),
    ]);

    expect(records).toEqual([
      {
        apiName: 'writeFile',
        arguments: JSON.stringify({ path: '/work/a.ts' }),
        identifier: 'lobe-cloud-sandbox',
        state: { path: '/work/a.ts', success: true },
        toolCallId: 't1',
      },
      {
        apiName: 'editFile',
        arguments: JSON.stringify({ path: '/work/a.ts' }),
        identifier: 'lobe-cloud-sandbox',
        state: { linesAdded: 2, path: '/work/a.ts' },
        toolCallId: 't2',
      },
    ]);
  });

  it('tolerates empty blocks / tool lists', () => {
    expect(collectFileEditToolCallRecords([])).toEqual([]);
    expect(collectFileEditToolCallRecords([block([])])).toEqual([]);
  });

  // Regression: a tool call with no merged result never executed (pending
  // human approval, or the run was interrupted first). Forwarding it would let
  // the scanner fall back to `arguments.path` and show a file as edited that
  // was never actually written.
  it('drops tool calls that have no result yet', () => {
    const records = collectFileEditToolCallRecords([
      block([
        tool({ apiName: 'writeFile', arguments: JSON.stringify({ path: '/work/a.ts' }), id: 't1' }),
        sandboxWrite('t2', '/work/b.ts'),
      ]),
    ]);

    expect(records.map((record) => record.toolCallId)).toEqual(['t2']);
  });
});

describe('deriveOperationEditedFiles', () => {
  it('aggregates multi-file edits across blocks', () => {
    const entries = deriveOperationEditedFiles([
      block([sandboxWrite('t1', '/work/a.ts')]),
      block([
        sandboxEdit('t2', '/work/a.ts', { diffText: '@@ a', linesAdded: 3, linesDeleted: 1 }),
        sandboxWrite('t3', '/work/b.ts'),
      ]),
    ]);

    expect(entries.map((e) => [e.path, e.kind])).toEqual([
      ['/work/a.ts', 'added'],
      ['/work/b.ts', 'added'],
    ]);
    // Deltas fold onto the write→edit chain for a.ts.
    expect(entries[0]).toMatchObject({ diffTexts: ['@@ a'], linesAdded: 3, linesDeleted: 1 });
  });

  it('drops entity-format files (they surface as file Works) but keeps html + other', () => {
    const entries = deriveOperationEditedFiles(
      [
        block([
          sandboxWrite('t1', '/work/deck.pptx'),
          sandboxWrite('t2', '/work/data.xlsx'),
          sandboxWrite('t3', '/work/report.pdf'),
          sandboxWrite('t4', '/work/index.html'),
          sandboxWrite('t5', '/work/notes.md'),
        ]),
      ],
      true,
    );

    expect(entries.map((e) => e.path)).toEqual(['/work/index.html', '/work/notes.md']);
  });

  it('keeps sandbox entity files when the round has no work surface (legacy client runtime)', () => {
    // Without a work anchor no file Work registers, so dropping the entry
    // would make the file invisible on both surfaces — the card keeps it.
    const entries = deriveOperationEditedFiles([
      block([sandboxWrite('t1', '/work/deck.pptx'), sandboxWrite('t2', '/work/notes.md')]),
    ]);

    expect(entries.map((e) => e.path)).toEqual(['/work/deck.pptx', '/work/notes.md']);
  });

  it('keeps a hetero-edited entity file in the card (no file Work covers it)', () => {
    // Registration only exports from the cloud sandbox, so a codex-edited
    // entity file registers no Work — the card is the only place it can show.
    const codexCsv = tool({
      apiName: 'file_change',
      id: 't2',
      identifier: 'codex',
      result: {
        content: '',
        id: 't2-r',
        state: {
          changes: [{ kind: 'update', linesAdded: 2, linesDeleted: 1, path: '/repo/data.csv' }],
        },
      },
    });

    const entries = deriveOperationEditedFiles(
      [block([sandboxWrite('t1', '/work/deck.pptx'), codexCsv])],
      true,
    );

    expect(entries.map((e) => e.path)).toEqual(['/repo/data.csv']);
  });

  it('drops an entity file only when its LAST edit is sandbox-backed', () => {
    // Sandbox writes it, codex re-edits it → the Work provenance rule keys off
    // the last edit, so no Work registers and the card must keep the file.
    const codexReEdit = tool({
      apiName: 'file_change',
      id: 't2',
      identifier: 'codex',
      result: {
        content: '',
        id: 't2-r',
        state: {
          changes: [{ kind: 'update', linesAdded: 1, linesDeleted: 0, path: '/work/deck.pptx' }],
        },
      },
    });

    const entries = deriveOperationEditedFiles(
      [block([sandboxWrite('t1', '/work/deck.pptx'), codexReEdit])],
      true,
    );

    expect(entries.map((e) => e.path)).toEqual(['/work/deck.pptx']);
  });

  it('drops a tool call whose result carries an error', () => {
    const entries = deriveOperationEditedFiles([
      block([
        tool({
          apiName: 'writeFile',
          arguments: JSON.stringify({ path: '/work/a.ts' }),
          id: 't1',
          result: { content: '', error: 'boom', id: 't1-r', state: { path: '/work/a.ts' } },
        }),
      ]),
    ]);
    expect(entries).toEqual([]);
  });

  it('returns an empty list when the operation touched no files', () => {
    expect(deriveOperationEditedFiles([])).toEqual([]);
    expect(
      deriveOperationEditedFiles([
        block([
          tool({
            apiName: 'runCommand',
            id: 't1',
            result: { content: '', id: 'r', state: { success: true } },
          }),
        ]),
      ]),
    ).toEqual([]);
  });
});

describe('summarizeEditedFilesTotals', () => {
  it('sums per-file line deltas', () => {
    const entries = deriveOperationEditedFiles([
      block([
        sandboxEdit('t1', '/a.ts', { linesAdded: 3, linesDeleted: 1 }),
        sandboxEdit('t2', '/b.ts', { linesAdded: 4, linesDeleted: 2 }),
      ]),
    ]);
    expect(summarizeEditedFilesTotals(entries)).toEqual({ linesAdded: 7, linesDeleted: 3 });
  });

  it('is zero for an empty list', () => {
    expect(summarizeEditedFilesTotals([])).toEqual({ linesAdded: 0, linesDeleted: 0 });
  });
});
