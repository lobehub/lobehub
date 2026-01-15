import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createValidator } from './createValidator';

describe('createValidator', () => {
  it('should validate query for GET and pass parsed data to handler', async () => {
    const validate = createValidator({
      errorStatus: 422,
      stopOnFirstError: true,
      omitNotShapeField: true,
    });
    const schema = z.object({ type: z.enum(['a', 'b']) });

    const handler = validate(schema)(async (_req: Request, _ctx: unknown, data: any) => {
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    });

    const res = await handler(new NextRequest('https://example.com/api?type=a'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { type: 'a' } });
  });

  it('should return 422 with one issue when stopOnFirstError', async () => {
    const validate = createValidator({
      errorStatus: 422,
      stopOnFirstError: true,
      omitNotShapeField: true,
    });
    const schema = z.object({
      foo: z.string().min(2),
      type: z.enum(['a', 'b']),
    });

    const handler = validate(schema)(async () => new Response('ok'));
    const res = await handler(new NextRequest('https://example.com/api?foo=x&type=c'));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues).toHaveLength(1);
  });

  it('should omit unknown fields when omitNotShapeField enabled', async () => {
    const validate = createValidator({
      errorStatus: 422,
      stopOnFirstError: true,
      omitNotShapeField: true,
    });
    const schema = z.object({ type: z.enum(['a', 'b']) });

    const handler = validate(schema)(async (_req: Request, _ctx: unknown, data: any) => {
      return new Response(JSON.stringify(data), { status: 200 });
    });

    const res = await handler(new NextRequest('https://example.com/api?type=a&extra=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 'a' });
  });
});
