// @vitest-environment node
import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

import type { ExecutionSnapshot } from '@lobechat/agent-tracing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const compressZstd = promisify(zstdCompress);
const decompressZstd = promisify(zstdDecompress);

// Stub FileS3 with vi.fn methods so we can assert calls + return canned data.
const uploadBuffer = vi.fn();
const getFileByteArray = vi.fn();
const getFileContent = vi.fn();
const deleteFile = vi.fn();

vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(() => ({
    deleteFile,
    getFileByteArray,
    getFileContent,
    uploadBuffer,
  })),
}));

// Imported after the mock so the constructor pulls in the stub.
const { S3SnapshotStore } = await import('./S3SnapshotStore');

const sampleSnapshot = (overrides: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot =>
  ({
    agentId: 'agt_abc',
    completedAt: 1_777_000_000_500,
    operationId: 'op_1777000000000_agt_abc_tpc_xyz_QwErTy',
    startedAt: 1_777_000_000_000,
    steps: [],
    topicId: 'tpc_xyz',
    totalCost: 0,
    totalSteps: 0,
    totalTokens: 0,
    ...overrides,
  }) as unknown as ExecutionSnapshot;

beforeEach(() => {
  uploadBuffer.mockReset().mockResolvedValue(undefined);
  getFileByteArray.mockReset();
  getFileContent.mockReset();
  deleteFile.mockReset().mockResolvedValue(undefined);
});

describe('S3SnapshotStore.save', () => {
  it('writes to agent-traces/{agentId}/{topicId}/{operationId}.json.zst with zstd body', async () => {
    const store = new S3SnapshotStore();
    const snap = sampleSnapshot();

    await store.save(snap);

    expect(uploadBuffer).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = uploadBuffer.mock.calls[0];
    expect(key).toBe(`agent-traces/${snap.agentId}/${snap.topicId}/${snap.operationId}.json.zst`);
    expect(contentType).toBe('application/zstd');
    expect(Buffer.isBuffer(body)).toBe(true);

    // zstd frame magic: 0x28 b5 2f fd
    expect([body[0], body[1], body[2], body[3]]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);

    const roundtripped = JSON.parse((await decompressZstd(body)).toString('utf8'));
    expect(roundtripped).toEqual(snap);
  });

  it('falls back to "unknown" when agentId or topicId is missing', async () => {
    const store = new S3SnapshotStore();
    await store.save(sampleSnapshot({ agentId: undefined, topicId: undefined }));

    const [key] = uploadBuffer.mock.calls[0];
    expect(key).toBe(
      'agent-traces/unknown/unknown/op_1777000000000_agt_abc_tpc_xyz_QwErTy.json.zst',
    );
  });
});

describe('S3SnapshotStore.savePartial', () => {
  it('writes to agent-traces/_partial/{operationId}.json.zst with compressed body', async () => {
    const store = new S3SnapshotStore();
    const partial = { operationId: 'op_partial_1', steps: [{ stepIndex: 0 }] };

    await store.savePartial('op_partial_1', partial as Partial<ExecutionSnapshot>);

    expect(uploadBuffer).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = uploadBuffer.mock.calls[0];
    expect(key).toBe('agent-traces/_partial/op_partial_1.json.zst');
    expect(contentType).toBe('application/zstd');

    const roundtripped = JSON.parse((await decompressZstd(body)).toString('utf8'));
    expect(roundtripped).toEqual(partial);
  });
});

describe('S3SnapshotStore.loadPartial', () => {
  it('decodes the zstd-compressed .json.zst object when present', async () => {
    const partial = { operationId: 'op_load_1', steps: [{ stepIndex: 7 }] };
    const compressed = await compressZstd(Buffer.from(JSON.stringify(partial)));
    getFileByteArray.mockResolvedValueOnce(new Uint8Array(compressed));

    const store = new S3SnapshotStore();
    const result = await store.loadPartial('op_load_1');

    expect(getFileByteArray).toHaveBeenCalledWith('agent-traces/_partial/op_load_1.json.zst');
    expect(result).toEqual(partial);
  });

  it('falls back to legacy uncompressed .json when .json.zst is missing', async () => {
    const partial = { operationId: 'op_legacy_1' };
    getFileByteArray.mockRejectedValueOnce(new Error('NoSuchKey'));
    getFileContent.mockResolvedValueOnce(JSON.stringify(partial));

    const store = new S3SnapshotStore();
    const result = await store.loadPartial('op_legacy_1');

    expect(getFileByteArray).toHaveBeenCalledWith('agent-traces/_partial/op_legacy_1.json.zst');
    expect(getFileContent).toHaveBeenCalledWith('agent-traces/_partial/op_legacy_1.json');
    expect(result).toEqual(partial);
  });

  it('returns null when neither key exists', async () => {
    getFileByteArray.mockRejectedValueOnce(new Error('NoSuchKey'));
    getFileContent.mockRejectedValueOnce(new Error('NoSuchKey'));

    const store = new S3SnapshotStore();
    expect(await store.loadPartial('op_missing')).toBeNull();
  });
});

describe('S3SnapshotStore.removePartial', () => {
  it('deletes both the .json.zst and legacy .json keys', async () => {
    const store = new S3SnapshotStore();
    await store.removePartial('op_remove_1');

    const keys = deleteFile.mock.calls.map(([k]) => k);
    expect(keys).toContain('agent-traces/_partial/op_remove_1.json.zst');
    expect(keys).toContain('agent-traces/_partial/op_remove_1.json');
    expect(deleteFile).toHaveBeenCalledTimes(2);
  });

  it('does not throw when one delete fails (allSettled)', async () => {
    deleteFile.mockRejectedValueOnce(new Error('NoSuchKey')).mockResolvedValueOnce(undefined);

    const store = new S3SnapshotStore();
    await expect(store.removePartial('op_partial_err')).resolves.toBeUndefined();
  });
});

describe('S3SnapshotStore query stubs', () => {
  it('returns null/[] for unsupported query methods (OTEL backend owns querying)', async () => {
    const store = new S3SnapshotStore();
    expect(await store.get('any')).toBeNull();
    expect(await store.getLatest()).toBeNull();
    expect(await store.list()).toEqual([]);
    expect(await store.listPartials()).toEqual([]);
  });
});
