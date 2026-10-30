import { terminalRecord } from '@lobechat/utils/verify/terminalEvidence.fixture';
import { describe, expect, it, vi } from 'vitest';

import { resolveEvidenceFiles } from '../evidenceFiles';
import { resolveEvidenceMetadata } from '../terminalEvidence';

const HASH = 'a'.repeat(64);
const file = { fileHash: HASH, size: 3 };

describe('resolveEvidenceMetadata', () => {
  it('stores a valid terminal record whose artifacts are the caller’s own matching files', async () => {
    const findFile = vi.fn().mockResolvedValue(file);
    const metadata = (await resolveEvidenceMetadata(findFile, 'terminal', {
      terminal: terminalRecord(),
    })) as { terminal: { execution: { command: string } } };
    expect(findFile).toHaveBeenCalledWith('file_1');
    expect(metadata.terminal.execution.command).toBe('ls -la');
  });

  it('refuses terminal evidence without a valid record', async () => {
    await expect(resolveEvidenceMetadata(vi.fn(), 'terminal', undefined)).rejects.toThrow(
      /Invalid terminal evidence metadata/,
    );
    await expect(
      resolveEvidenceMetadata(vi.fn(), 'terminal', {
        terminal: { ...terminalRecord(), version: 9 },
      }),
    ).rejects.toThrow(/terminal.version/);
  });

  it('refuses artifacts that are missing, foreign, or not the hashed file', async () => {
    const noFileId = terminalRecord({
      artifacts: { stdout: { path: 'stdout.txt', sha256: HASH, size: 3 } },
    });
    await expect(
      resolveEvidenceMetadata(vi.fn(), 'terminal', { terminal: noFileId }),
    ).rejects.toThrow(/no fileId/);
    await expect(
      resolveEvidenceMetadata(vi.fn().mockResolvedValue(undefined), 'terminal', {
        terminal: terminalRecord(),
      }),
    ).rejects.toThrow(/does not exist or is not yours/);
    await expect(
      resolveEvidenceMetadata(
        vi.fn().mockResolvedValue({ fileHash: 'b'.repeat(64), size: 3 }),
        'terminal',
        {
          terminal: terminalRecord(),
        },
      ),
    ).rejects.toThrow(/does not match/);
    await expect(
      resolveEvidenceMetadata(vi.fn().mockResolvedValue({ fileHash: HASH, size: 4 }), 'terminal', {
        terminal: terminalRecord(),
      }),
    ).rejects.toThrow(/does not match/);
  });

  it('drops a terminal record smuggled onto another medium', async () => {
    expect(
      await resolveEvidenceMetadata(vi.fn(), 'text', {
        comparison: { id: 'x' },
        terminal: terminalRecord(),
      }),
    ).toEqual({ comparison: { id: 'x' } });
    expect(
      await resolveEvidenceMetadata(vi.fn(), 'text', { terminal: terminalRecord() }),
    ).toBeNull();
  });
});

describe('resolveEvidenceFiles', () => {
  const resolveFileMeta = vi.fn(async (fileId: string | null) => ({
    fileHeight: null,
    fileName: fileId,
    fileUrl: fileId ? `https://s3.test/${fileId}?sig` : null,
    fileWidth: null,
  }));

  it('signs every artifact a terminal record references', async () => {
    const resolved = await resolveEvidenceFiles(resolveFileMeta, {
      fileId: null,
      metadata: { terminal: terminalRecord() },
      type: 'terminal',
    });
    expect(resolved.terminalArtifacts).toEqual({
      stdout: { fileUrl: 'https://s3.test/file_1?sig', sha256: HASH, size: 3 },
    });
  });

  it('leaves other evidence and broken records without artifacts', async () => {
    expect(
      (
        await resolveEvidenceFiles(resolveFileMeta, {
          fileId: 'f',
          metadata: { terminal: terminalRecord() },
          type: 'text',
        })
      ).terminalArtifacts,
    ).toBeUndefined();
    expect(
      (
        await resolveEvidenceFiles(resolveFileMeta, {
          metadata: { terminal: {} },
          type: 'terminal',
        })
      ).terminalArtifacts,
    ).toBeUndefined();
  });
});
