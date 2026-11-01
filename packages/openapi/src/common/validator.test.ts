import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { zValidator } from './validator';

describe('zValidator', () => {
  it('returns the shared public error envelope for invalid input', async () => {
    const app = new Hono();
    app.get('/', zValidator('query', z.object({ page: z.coerce.number().int().min(1) })), (c) =>
      c.json({ success: true }),
    );

    const response = await app.request('/?page=0');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false });
    expect(body.error).toEqual(expect.any(String));
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
