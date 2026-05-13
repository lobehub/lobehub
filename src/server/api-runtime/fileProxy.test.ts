// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/(backend)/f/[id]/route';
import { FileModel } from '@/database/models/file';
import honoApp from '@/server/hono';

vi.mock('@/database/models/file', () => ({
  FileModel: {
    getFileById: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: vi.fn(() => ({})),
  isRedisEnabled: vi.fn(() => false),
}));

const createRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/f/missing-file', { headers });

const createSegmentData = () => ({ params: Promise.resolve({ id: 'missing-file' }) });

const expectFileNotFound = async (response: Response) => {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('File not found');
};

beforeEach(() => {
  vi.mocked(FileModel.getFileById).mockResolvedValue(undefined);
});

describe('/f/:id runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await GET(createRequest(), createSegmentData());

    expect(response.headers.get('x-lobe-api-runtime')).toBe('next');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectFileNotFound(response);
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await GET(
      createRequest({ 'x-lobe-api-runtime': 'hono' }),
      createSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime')).toBe('hono');
    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectFileNotFound(response);
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createRequest());

    await expectFileNotFound(response);
  });
});
