import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiErrorSchema } from './errors';
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
    expect(ApiErrorSchema.parse(body)).toBeTruthy();
    expect(body).toMatchObject({ code: 'validation_error', success: false });
    expect(body.error).toBe(body.message);
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('lists every failing field as a dotted path instead of a stringified issue dump', async () => {
    const app = new Hono();
    app.post(
      '/',
      zValidator(
        'json',
        z.object({ items: z.array(z.object({ name: z.string() })), title: z.string() }),
      ),
      (c) => c.json({ success: true }),
    );

    const response = await app.request('/', {
      body: JSON.stringify({ items: [{ name: 1 }] }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = await response.json();

    expect(body.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'json.items.0.name',
      'json.title',
    ]);
    expect(body.error).not.toContain('"code"');
    expect(body.message).toMatch(/^Invalid request: json\./);
  });
});
