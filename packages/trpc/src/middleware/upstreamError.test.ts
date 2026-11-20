import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { trpc } from '../lambda/init';
import { toUpstreamTRPCError, upstreamError } from './upstreamError';

const sdkError = (props: Record<string, unknown>, metadata: Record<string, unknown> = {}) =>
  Object.assign(new Error(String(props.name ?? 'UnknownError')), props, {
    $metadata: { attempts: 3, totalRetryDelay: 195, ...metadata },
  });

const createRouter = (thrown: unknown) => {
  const appRouter = trpc.router({
    run: trpc.procedure.use(upstreamError).mutation(() => {
      throw thrown;
    }),
  });

  return createCallerFactory(appRouter);
};

const callWith = async (thrown: unknown) => {
  const caller = createRouter(thrown)(await createContextInner());
  return caller.run().catch((error: TRPCError) => error);
};

describe('upstreamError middleware', () => {
  it('maps an upstream 5xx (R2 HeadObject 500) to BAD_GATEWAY', async () => {
    const cause = sdkError({ $fault: 'server', name: 'UnknownError' }, { httpStatusCode: 500 });

    const error = await callWith(cause);

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe('BAD_GATEWAY');
    expect(error.message).toBe('Upstream service error (HTTP 500): UnknownError');
    expect(error.cause).toBe(cause);
  });

  it('maps an upstream 503 to BAD_GATEWAY', async () => {
    const error = await callWith(
      sdkError({ $fault: 'server', name: 'ServiceUnavailable' }, { httpStatusCode: 503 }),
    );

    expect(error.code).toBe('BAD_GATEWAY');
  });

  it('maps an SDK timeout to GATEWAY_TIMEOUT', async () => {
    const error = await callWith(sdkError({ code: 'ETIMEDOUT', name: 'TimeoutError' }));

    expect(error.code).toBe('GATEWAY_TIMEOUT');
    expect(error.message).toBe('Upstream service error: TimeoutError');
  });

  it('maps a socket failure to BAD_GATEWAY', async () => {
    const error = await callWith(sdkError({ code: 'ECONNRESET', name: 'Error' }));

    expect(error.code).toBe('BAD_GATEWAY');
  });

  it('finds the SDK error deeper in the cause chain', async () => {
    const root = sdkError({ $fault: 'server', name: 'InternalError' }, { httpStatusCode: 500 });
    const wrapped = new Error('reserve failed', { cause: root });

    const error = await callWith(wrapped);

    expect(error.code).toBe('BAD_GATEWAY');
    expect(error.cause).toBe(root);
  });

  it('keeps upstream 4xx as INTERNAL_SERVER_ERROR (misconfiguration is our bug)', async () => {
    const error = await callWith(
      sdkError({ $fault: 'client', name: 'AccessDenied' }, { httpStatusCode: 403 }),
    );

    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('keeps SDK errors without a response or network code as INTERNAL_SERVER_ERROR', async () => {
    const error = await callWith(sdkError({ name: 'CredentialsProviderError' }));

    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('leaves plain errors untouched', async () => {
    const error = await callWith(new Error('boom'));

    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.message).toBe('boom');
  });

  it('does not override codes routers chose deliberately', async () => {
    const error = await callWith(
      new TRPCError({
        cause: sdkError({ $fault: 'server' }, { httpStatusCode: 500 }),
        code: 'CONFLICT',
      }),
    );

    expect(error.code).toBe('CONFLICT');
  });
});

describe('toUpstreamTRPCError', () => {
  it('returns undefined when there is no cause', () => {
    expect(toUpstreamTRPCError(new TRPCError({ code: 'INTERNAL_SERVER_ERROR' }))).toBeUndefined();
  });
});
