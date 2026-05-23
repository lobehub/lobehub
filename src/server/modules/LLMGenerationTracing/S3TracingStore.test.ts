// @vitest-environment node
import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

import type { TracingPayload } from '@lobechat/llm-generation-tracing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const compressZstd = promisify(zstdCompress);
const decompressZstd = promisify(zstdDecompress);

const uploadBuffer = vi.fn();
const getFileByteArray = vi.fn();

vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(() => ({ getFileByteArray, uploadBuffer })),
}));

const { S3TracingStore, buildTracingKey } = await import('./S3TracingStore');

const samplePayload = (overrides: Partial<TracingPayload> = {}): TracingPayload => ({
  created_at: new Date('2026-05-22T11:22:33.444Z').getTime(),
  prompt_hash: 'ab1fc3',
  prompt_version: 'v1.0',
  scenario: 'home_brief',
  tracing_id: '00000000-0000-0000-0000-000000000001',
  version: '1.0',
  ...overrides,
});

beforeEach(() => {
  uploadBuffer.mockReset().mockResolvedValue(undefined);
  getFileByteArray.mockReset();
});

describe('buildTracingKey', () => {
  it('lays out scenario / version-hash / date / id with the .json.zst suffix', () => {
    const key = buildTracingKey(samplePayload());
    expect(key).toBe(
      'llm-generation-tracing/home_brief/v1.0-ab1fc3/2026-05-22/00000000-0000-0000-0000-000000000001.json.zst',
    );
  });

  it('sanitises path-unsafe characters in scenario and version segments', () => {
    const key = buildTracingKey(samplePayload({ prompt_version: 'v 2/0', scenario: 'odd name!' }));
    expect(key).toMatch(
      /llm-generation-tracing\/odd_name_\/v_2_0-ab1fc3\/2026-05-22\/00000000-0000-0000-0000-000000000001\.json\.zst/,
    );
  });
});

describe('S3TracingStore.save', () => {
  it('uploads zstd-compressed JSON with the canonical key and content-type', async () => {
    const store = new S3TracingStore();
    const payload = samplePayload({ input: { messages: [{ role: 'user' }] } });

    const { key } = await store.save(payload);

    expect(key).toBe(
      'llm-generation-tracing/home_brief/v1.0-ab1fc3/2026-05-22/00000000-0000-0000-0000-000000000001.json.zst',
    );
    expect(uploadBuffer).toHaveBeenCalledTimes(1);

    const [callKey, body, contentType] = uploadBuffer.mock.calls[0];
    expect(callKey).toBe(key);
    expect(contentType).toBe('application/zstd');
    expect(Buffer.isBuffer(body)).toBe(true);
    expect([body[0], body[1], body[2], body[3]]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);

    const roundtripped = JSON.parse((await decompressZstd(body)).toString('utf8'));
    expect(roundtripped).toEqual(payload);
  });
});

describe('S3TracingStore.get', () => {
  it('decompresses a stored payload by key', async () => {
    const store = new S3TracingStore();
    const payload = samplePayload();
    const buf = await compressZstd(Buffer.from(JSON.stringify(payload)));
    getFileByteArray.mockResolvedValueOnce(new Uint8Array(buf));

    const loaded = await store.get('some/key.json.zst');
    expect(loaded).toEqual(payload);
  });

  it('returns null when the key is missing', async () => {
    const store = new S3TracingStore();
    getFileByteArray.mockRejectedValueOnce(new Error('NoSuchKey'));
    expect(await store.get('missing')).toBeNull();
  });
});
