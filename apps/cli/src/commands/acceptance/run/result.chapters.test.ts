import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import { uploadLocalFile } from '../../../utils/uploadLocalFile';
import type * as VerifyHelpers from '../utils';
import { usePublicationHarness } from './testUtils';

vi.mock('../../../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../../../api/workspace', () => ({ resolveWorkspaceId: vi.fn() }));
vi.mock('../../../settings', () => ({ resolveServerUrl: vi.fn() }));
vi.mock('../../../utils/uploadLocalFile', () => ({ uploadLocalFile: vi.fn() }));
vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof VerifyHelpers>()),
  pullRequestFromBranch: vi.fn(),
}));

describe('lh acceptance run', () => {
  const h = usePublicationHarness();
  const { client, run } = h;

  describe('result submit chapters', () => {
    const chapters = [
      { kind: 'step', label: 'Reload with listDevices held', t: 1.2 },
      { kind: 'check', note: 'First frame already shows the cached device', t: 2.4 },
    ];
    const submit = (...extra: string[]) =>
      run(
        'result',
        'submit',
        '--operation',
        'op-1',
        '--item',
        'reload',
        '--file',
        path.join(h.dir, 'scroll.mp4'),
        '--type',
        'video',
        ...extra,
      );

    beforeEach(() => {
      client.verify.submitCheckEvidence.mutate.mockResolvedValue({
        checkResult: { id: 'result-reload', verifyRunId: 'run-1' },
        evidence: [{ id: 'evidence-1' }],
      });
      client.verify.getRun.query.mockResolvedValue({ acceptanceId: 'acceptance-1', id: 'run-1' });
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`);
      }) as never);
      vi.spyOn(log, 'error').mockImplementation(() => {});
    });

    it('attaches a plan-round video with its chapters', async () => {
      await writeFile(path.join(h.dir, 'chapters.json'), JSON.stringify(chapters));

      await submit('--chapters', path.join(h.dir, 'chapters.json'));

      expect(client.verify.submitCheckEvidence.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          checkItemId: 'reload',
          evidence: [expect.objectContaining({ metadata: { chapters }, type: 'video' })],
          operationId: 'op-1',
        }),
      );
    });

    it('rejects a malformed marker before uploading anything', async () => {
      await writeFile(
        path.join(h.dir, 'chapters.json'),
        JSON.stringify([...chapters, { kind: 'check', t: 3 }]),
      );

      await expect(submit('--chapters', path.join(h.dir, 'chapters.json'))).rejects.toThrow(
        '1 of 3 chapters are malformed',
      );
      expect(uploadLocalFile).not.toHaveBeenCalled();
      expect(client.verify.submitCheckEvidence.mutate).not.toHaveBeenCalled();
    });

    it('rejects chapters on evidence that has no timeline', async () => {
      await writeFile(path.join(h.dir, 'chapters.json'), JSON.stringify(chapters));

      await expect(
        run(
          'result',
          'submit',
          '--operation',
          'op-1',
          '--item',
          'reload',
          '--file',
          path.join(h.dir, "screen's shot.png"),
          '--type',
          'screenshot',
          '--chapters',
          path.join(h.dir, 'chapters.json'),
        ),
      ).rejects.toThrow('--chapters only applies to --type video evidence');
      expect(client.verify.submitCheckEvidence.mutate).not.toHaveBeenCalled();
    });
  });
});
