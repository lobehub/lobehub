import { deriveOperationEditedFiles } from '@lobechat/builtin-tools/operationArtifacts';
import type { AssistantContentBlock, ChatToolPayloadWithResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { summarizeEditedFilesTotals } from './deriveEditedFiles';

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
