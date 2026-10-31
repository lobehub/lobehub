// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertFileNotInRestrictedKnowledgeBase } from '../_helpers/knowledgeBaseAccess';
import { assertFilesNotInRestrictedKnowledgeBase, FILE_ACCESS_CHECK_CONCURRENCY } from './remove';

vi.mock('../_helpers/knowledgeBaseAccess', () => ({
  assertFileNotInRestrictedKnowledgeBase: vi.fn(),
}));

const ctx = { workspaceId: 'ws-1' } as Parameters<
  typeof assertFilesNotInRestrictedKnowledgeBase
>[0];
const files = Array.from({ length: 12 }, (_, i) => ({ id: `file-${i}` }));

describe('assertFilesNotInRestrictedKnowledgeBase', () => {
  beforeEach(() => {
    vi.mocked(assertFileNotInRestrictedKnowledgeBase).mockReset();
  });

  it('checks every file and caps the checks in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(assertFileNotInRestrictedKnowledgeBase).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });

    await assertFilesNotInRestrictedKnowledgeBase(ctx, files);

    expect(vi.mocked(assertFileNotInRestrictedKnowledgeBase).mock.calls).toEqual(
      files.map((file) => [ctx, file.id]),
    );
    expect(maxInFlight).toBe(FILE_ACCESS_CHECK_CONCURRENCY);
  });

  it('rejects with the first restricted-file error', async () => {
    const error = new Error('restricted');
    vi.mocked(assertFileNotInRestrictedKnowledgeBase).mockImplementation(async (_ctx, id) => {
      if (id === 'file-3') throw error;
    });

    await expect(assertFilesNotInRestrictedKnowledgeBase(ctx, files)).rejects.toBe(error);
  });
});
