// @vitest-environment node
import { TRPCClientError } from '@trpc/client';
import type { LoaderFunctionArgs } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { loader } from './shareTopicText';

const query = vi.hoisted(() => vi.fn());
vi.mock('../lib/serverTrpc', () => ({
  createServerLambdaClient: () => ({ share: { getSharedTopicText: { query } } }),
}));

const args = {
  context: { get: () => ({ env: {} }) },
  params: { id: 'share-id' },
  request: new Request('https://lobehub.com/share/t/share-id/llm.txt'),
} as unknown as LoaderFunctionArgs;

beforeEach(() => vi.resetAllMocks());

it('serves the complete transcript as non-cacheable plain text', async () => {
  const text = '## User\n\nQuestion\n\n## Assistant\n\nAnswer'.repeat(1001);
  query.mockResolvedValue({ text, title: 'Topic' });
  const response = await loader(args);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.text()).toBe(`# Topic\n\n${text}`);
  expect(query).toHaveBeenCalledWith({ shareId: 'share-id' });
});

it.each([403, 404])(
  'preserves access/not-found status %s without exposing diagnostics',
  async (httpStatus) => {
    query.mockRejectedValue(
      TRPCClientError.from({
        error: {
          code: -32003,
          message: 'Internal diagnostic',
          data: { httpStatus },
        },
      }),
    );
    const response = await loader(args);
    expect(response.status).toBe(httpStatus);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toContain('Internal diagnostic');
  },
);
