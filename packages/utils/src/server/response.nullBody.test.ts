import { describe, expect, it, vi } from 'vitest';

import { ensureNodeResponse } from './response';

describe('normalizing responses with no body', () => {
  it.each([204, 205, 304])('preserves a null body for status %s', async (status) => {
    const response = new Response(null, { headers: { etag: 'version-1' }, status });

    const result = await ensureNodeResponse(response);

    expect(result.status).toBe(status);
    expect(result.body).toBeNull();
    expect(result.headers.get('etag')).toBe('version-1');
  });

  it('preserves a null body even when buffering is requested', async () => {
    const response = new Response(null, { status: 204 });
    const result = await ensureNodeResponse(response, { forceBuffering: true });
    expect(result.body).toBeNull();
  });

  it('still buffers SDK shims that omit a body property', async () => {
    const response = {
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('sdk-body').buffer),
      headers: new Headers(),
      status: 200,
      statusText: 'OK',
    } as unknown as Response;
    expect(await (await ensureNodeResponse(response)).text()).toBe('sdk-body');
  });
});
