import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FileModelModule from '@/database/models/file';

import { verifyRouter } from '.';

const modelMocks = vi.hoisted(() => ({
  createEvidence: vi.fn(),
  createManyEvidence: vi.fn(),
  findFileById: vi.fn(),
  findResultById: vi.fn(),
  findRunById: vi.fn(),
  findRunByOperation: vi.fn(),
  listResultsByRun: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return {
      findById: modelMocks.findResultById,
      listByRun: modelMocks.listResultsByRun,
      upsertByCheckItem: modelMocks.upsertByCheckItem,
    };
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      findByOperation: modelMocks.findRunByOperation,
      findById: modelMocks.findRunById,
    };
  }),
}));

// Only the instance lookup the evidence write path uses is stubbed.
vi.mock('@/database/models/file', async (importOriginal) => {
  const actual = await importOriginal<typeof FileModelModule>();
  class FileModel extends actual.FileModel {
    findById = modelMocks.findFileById as unknown as actual.FileModel['findById'];
  }
  return { ...actual, FileModel };
});

vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { create: modelMocks.createEvidence, createMany: modelMocks.createManyEvidence };
  }),
}));

// The router context builds a FileService, which needs S3 env without this.
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { getFullFileUrl: vi.fn() };
  }),
}));

const createCaller = () => verifyRouter.createCaller({ userId: 'verify-router-test-user' } as any);

describe('verifyRouter evidence writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.listResultsByRun.mockResolvedValue([]);
    modelMocks.findFileById.mockResolvedValue(undefined);
  });

  describe('submitCheckEvidence', () => {
    it("rejects a run outside the caller's scope before upserting", async () => {
      modelMocks.findRunById.mockResolvedValueOnce(undefined);

      await expect(
        createCaller().submitCheckEvidence({
          checkItemId: 'item-1',
          verdict: 'passed',
          verifyRunId: 'other-user-run',
        }),
      ).rejects.toThrow('Verification run not found');

      expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
      expect(modelMocks.createManyEvidence).not.toHaveBeenCalled();
    });

    it('rejects an evidence item with both inline content and fileId', async () => {
      await expect(
        createCaller().submitCheckEvidence({
          checkItemId: 'item-1',
          evidence: [{ content: 'inline', fileId: 'files-1', type: 'text' }],
          verifyRunId: 'run-1',
        }),
      ).rejects.toThrow('Provide exactly one of `content` or `fileId`.');
    });

    it('lazily upserts the check result and attaches evidence in one call', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1', verdict: 'passed' });
      modelMocks.createManyEvidence.mockResolvedValueOnce([{ id: 'evidence-1' }]);

      const res = await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ fileId: 'files-1', type: 'screenshot' }],
        verdict: 'passed',
        verifyRunId: 'run-1',
      });

      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({ checkItemId: 'item-1', verdict: 'passed', verifyRunId: 'run-1' }),
      );
      expect(modelMocks.createManyEvidence).toHaveBeenCalledWith([
        expect.objectContaining({
          checkResultId: 'result-1',
          fileId: 'files-1',
          type: 'screenshot',
        }),
      ]);
      expect(res).toEqual({
        checkResult: { id: 'result-1', verdict: 'passed' },
        evidence: [{ id: 'evidence-1' }],
      });
    });

    it('allows a verdict-only submit with no evidence', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1' });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1', verdict: 'failed' });

      const res = await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        verdict: 'failed',
        verifyRunId: 'run-1',
      });

      expect(modelMocks.createManyEvidence).not.toHaveBeenCalled();
      expect(res.evidence).toEqual([]);
    });

    it('requires either verifyRunId or operationId', async () => {
      await expect(
        createCaller().submitCheckEvidence({ checkItemId: 'item-1', verdict: 'passed' } as any),
      ).rejects.toThrow('Provide either `verifyRunId` or `operationId`.');
    });

    it('resolves the run from operationId when no verifyRunId is given', async () => {
      modelMocks.findRunByOperation.mockResolvedValueOnce({ id: 'run-9', plan: [] });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-9' });

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        operationId: 'op-1',
        verdict: 'passed',
      });

      expect(modelMocks.findRunByOperation).toHaveBeenCalledWith('op-1');
      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({ verifyRunId: 'run-9' }),
      );
    });

    it('does NOT reset required/status on an evidence-only submit (no clobber)', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1', plan: [] });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ content: 'note', type: 'text' }],
        verifyRunId: 'run-1',
      });

      const arg = modelMocks.upsertByCheckItem.mock.calls[0][0];
      // Both omitted → drizzle preserves the existing row's values / DB defaults.
      expect(arg.required).toBeUndefined();
      expect(arg.status).toBeUndefined();
    });

    it('hydrates required/verifierType/title from the run plan item', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({
        id: 'run-1',
        plan: [
          { id: 'item-1', index: 2, required: false, title: 'soft check', verifierType: 'llm' },
        ],
      });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ content: 'note', type: 'text' }],
        verifyRunId: 'run-1',
      });

      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({
          checkItemIndex: 2,
          checkItemTitle: 'soft check',
          required: false,
          verifierType: 'llm',
        }),
      );
    });

    it('lands evidence for a repaired check on the repair round, not the settled one', async () => {
      const plan = [{ id: 'item-1', index: 0, required: true, title: 'mutation gif' }];
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'round-1', plan, status: 'failed' });
      modelMocks.listResultsByRun.mockImplementation(async (runId: string) =>
        runId === 'round-1'
          ? [{ checkItemId: 'item-1', repairOperationId: 'repair-op-2' }]
          : [{ checkItemId: 'item-1', repairOperationId: null }],
      );
      modelMocks.findRunByOperation.mockResolvedValueOnce({
        id: 'round-2',
        plan,
        status: 'planned',
      });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({
        id: 'result-2',
        verifyRunId: 'round-2',
      });
      modelMocks.createManyEvidence.mockResolvedValueOnce([{ id: 'evidence-1' }]);

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ fileId: 'files-1', type: 'gif' }],
        verifyRunId: 'round-1',
      });

      expect(modelMocks.findRunByOperation).toHaveBeenCalledWith('repair-op-2');
      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({ checkItemId: 'item-1', verifyRunId: 'round-2' }),
      );
      expect(modelMocks.createManyEvidence).toHaveBeenCalledWith([
        expect.objectContaining({ checkResultId: 'result-2', type: 'gif' }),
      ]);
    });

    it('stores a GIF uploaded as video as a gif, not a video', async () => {
      // Builders without a gif type labelled their GIFs `video`; the acceptance
      // page then played an animated image in a video player that failed to load.
      modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1', plan: [] });
      modelMocks.findFileById.mockResolvedValueOnce({
        fileType: 'image/gif',
        id: 'files-gif',
        name: 'rename.gif',
      });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });
      modelMocks.createManyEvidence.mockResolvedValueOnce([{ id: 'evidence-1' }]);

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ fileId: 'files-gif', type: 'video' }],
        verifyRunId: 'run-1',
      });

      expect(modelMocks.findFileById).toHaveBeenCalledWith('files-gif');
      expect(modelMocks.createManyEvidence).toHaveBeenCalledWith([
        expect.objectContaining({ fileId: 'files-gif', type: 'gif' }),
      ]);
    });

    it('keeps the chapters a plan-round video is submitted with', async () => {
      // A Task's builder submits through this procedure; without metadata its
      // recordings reached the reviewer with no timeline to seek along.
      const chapters = [
        { kind: 'check', note: 'device chip renders on the first frame', t: 2.4 },
        { kind: 'step', label: 'Reload with listDevices held', t: 1.2 },
        { kind: 'check', t: 3 },
      ];
      modelMocks.findRunByOperation.mockResolvedValueOnce({ id: 'run-1', plan: [] });
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });
      modelMocks.createManyEvidence.mockResolvedValueOnce([
        { id: 'evidence-1' },
        { id: 'evidence-2' },
      ]);

      await createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [
          { fileId: 'files-video', metadata: { chapters }, type: 'video' },
          { fileId: 'files-shot', metadata: { chapters }, type: 'screenshot' },
        ],
        operationId: 'op-1',
      });

      expect(
        modelMocks.createManyEvidence.mock.calls[0][0].map(
          (row: { metadata: unknown }) => row.metadata,
        ),
      ).toEqual([
        {
          chapters: [
            { kind: 'step', label: 'Reload with listDevices held', t: 1.2 },
            { kind: 'check', note: 'device chip renders on the first frame', t: 2.4 },
          ],
        },
        null,
      ]);
    });

    it('rejects a check item that is not in the run plan instead of minting a required row', async () => {
      modelMocks.findRunById.mockResolvedValueOnce({
        id: 'run-1',
        plan: [{ id: 'item-1', index: 0, required: true, title: 'gateway matrix' }],
      });

      await expect(
        createCaller().submitCheckEvidence({
          checkItemId: 'pglite-classification',
          evidence: [{ content: 'grep output', type: 'text' }],
          verdict: 'passed',
          verifyRunId: 'run-1',
        }),
      ).rejects.toThrow(
        'Check item "pglite-classification" is not in this verification run\'s plan. Use one of: item-1 (gateway matrix)',
      );

      expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
      expect(modelMocks.createManyEvidence).not.toHaveBeenCalled();
    });
  });

  it('rejects an invalid terminal record before storing a verdict or evidence', async () => {
    modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1', plan: [] });

    await expect(
      createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [{ content: 'authored text', metadata: { terminal: {} }, type: 'terminal' }],
        verdict: 'passed',
        verifyRunId: 'run-1',
      }),
    ).rejects.toThrow('Invalid terminal evidence metadata');

    expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
    expect(modelMocks.createManyEvidence).not.toHaveBeenCalled();
  });

  it('resolves a large submission with bounded concurrency and inserts it once', async () => {
    modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1', plan: [] });
    modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });
    let inFlight = 0;
    let peak = 0;
    modelMocks.findFileById.mockImplementation(async (id: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { fileType: 'image/png', id, name: `${id}.png` };
    });
    const evidence = Array.from({ length: 12 }, (_, i) => ({
      fileId: `files-${i}`,
      type: 'screenshot' as const,
    }));
    modelMocks.createManyEvidence.mockResolvedValueOnce(evidence.map((_, i) => ({ id: `e-${i}` })));

    await createCaller().submitCheckEvidence({
      checkItemId: 'item-1',
      evidence,
      verifyRunId: 'run-1',
    });

    expect(modelMocks.findFileById).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(5);
    expect(modelMocks.createManyEvidence).toHaveBeenCalledTimes(1);
    expect(modelMocks.createManyEvidence.mock.calls[0][0]).toHaveLength(12);
  });

  describe('uploadEvidence', () => {
    it('rejects evidence with both inline content and fileId', async () => {
      await expect(
        createCaller().uploadEvidence({
          checkResultId: 'result-1',
          content: 'inline payload',
          fileId: 'files-1',
          type: 'text',
        }),
      ).rejects.toThrow('Provide exactly one of `content` or `fileId`.');
    });

    it('stores only well-formed chapters, and only on video evidence', async () => {
      const chapters = [
        { kind: 'check', note: 'no skeleton after scroll #3', t: 7.9 },
        { kind: 'step', label: 'Scroll #1', t: 2 },
        { kind: 'check', t: 3 }, // a claim without a note says nothing
        { kind: 'guess', note: 'unknown kind', t: 4 },
        { kind: 'flag', note: 'negative time', t: -1 },
      ];
      modelMocks.findResultById.mockResolvedValue({ id: 'result-1' });

      await createCaller().uploadEvidence({
        checkResultId: 'result-1',
        fileId: 'files-video',
        metadata: { chapters, comparison: { id: 'pair', role: 'after' } },
        type: 'video',
      });
      await createCaller().uploadEvidence({
        checkResultId: 'result-1',
        fileId: 'files-shot',
        metadata: { chapters },
        type: 'screenshot',
      });

      expect(modelMocks.createEvidence.mock.calls.map(([row]) => row.metadata)).toEqual([
        {
          chapters: [
            { kind: 'step', label: 'Scroll #1', t: 2 },
            { kind: 'check', note: 'no skeleton after scroll #3', t: 7.9 },
          ],
          comparison: { id: 'pair', role: 'after' },
        },
        null,
      ]);
      modelMocks.findResultById.mockReset();
    });

    it('rejects evidence without inline content or fileId', async () => {
      await expect(
        createCaller().uploadEvidence({
          checkResultId: 'result-1',
          type: 'text',
        }),
      ).rejects.toThrow('Provide exactly one of `content` or `fileId`.');
    });
  });

  describe.each(['uploadEvidence', 'submitCheckEvidence'] as const)(
    '%s inline evidence content limit',
    (procedure) => {
      const submit = (
        content: string,
        type: 'text' | 'markdown' | 'transcript' | 'dom_snapshot' | 'terminal' = 'text',
      ) =>
        procedure === 'uploadEvidence'
          ? createCaller().uploadEvidence({ checkResultId: 'result-1', content, type })
          : createCaller().submitCheckEvidence({
              checkItemId: 'item-1',
              evidence: [{ content, type }],
              verdict: 'passed',
              verifyRunId: 'run-1',
            });

      it.each([
        { label: 'CLI threshold', content: 'x'.repeat(5000) },
        { label: 'server boundary', content: 'x'.repeat(6000) },
        { label: 'Chinese boundary', content: '中'.repeat(6000) },
        { label: 'UTF-16 boundary', content: '😀'.repeat(3000) },
      ])('preserves $label content without truncation', async ({ content }) => {
        if (procedure === 'uploadEvidence') {
          modelMocks.findResultById.mockResolvedValueOnce({ id: 'result-1' });
          modelMocks.createEvidence.mockResolvedValueOnce({ id: 'evidence-1' });
        } else {
          modelMocks.findRunById.mockResolvedValueOnce({ id: 'run-1', plan: [] });
          modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1' });
          modelMocks.createManyEvidence.mockResolvedValueOnce([{ id: 'evidence-1' }]);
        }

        await submit(content);

        const row =
          procedure === 'uploadEvidence'
            ? modelMocks.createEvidence.mock.calls[0][0]
            : modelMocks.createManyEvidence.mock.calls[0][0][0];
        expect(row.content).toBe(content);
      });

      it.each(['text', 'markdown', 'transcript', 'dom_snapshot', 'terminal'] as const)(
        'rejects oversized %s evidence before any lookup or write',
        async (type) => {
          await expect(submit('x'.repeat(6001), type)).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: expect.stringContaining('6000'),
          });
          expect(modelMocks.findResultById).not.toHaveBeenCalled();
          expect(modelMocks.findRunById).not.toHaveBeenCalled();
          expect(modelMocks.findFileById).not.toHaveBeenCalled();
          expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
          expect(modelMocks.createEvidence).not.toHaveBeenCalled();
          expect(modelMocks.createManyEvidence).not.toHaveBeenCalled();
        },
      );

      it('counts surrogate pairs consistently with the CLI', async () => {
        await expect(submit('😀'.repeat(3001))).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: expect.stringContaining('6000'),
        });
      });
    },
  );

  it('rejects a batch containing oversized evidence before persisting any result', async () => {
    await expect(
      createCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        evidence: [
          { content: 'valid', type: 'text' },
          { content: 'x'.repeat(6001), type: 'text' },
        ],
        verdict: 'passed',
        verifyRunId: 'run-1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('6000') });

    expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
    expect(modelMocks.createManyEvidence).not.toHaveBeenCalled();
  });
});
