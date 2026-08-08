import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTRPCErrorLogger, markSilentTRPCErrorLog } from './errorLogger';

describe('createTRPCErrorLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs errors with the endpoint scope', () => {
    const onError = createTRPCErrorLogger('mobile');
    const error = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' });

    onError({ error, path: 'aiChat.outputJSON', type: 'mutation' });

    expect(console.info).toHaveBeenCalledWith(
      'Error in tRPC handler (mobile) on path: aiChat.outputJSON, type: mutation',
    );
    expect(console.error).toHaveBeenCalledWith(error);
  });

  it('skips UNAUTHORIZED errors', () => {
    const onError = createTRPCErrorLogger('lambda');
    const error = new TRPCError({ code: 'UNAUTHORIZED' });

    onError({ error, path: 'session.getSessions', type: 'query' });

    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('skips errors whose cause was marked via markSilentTRPCErrorLog', () => {
    const onError = createTRPCErrorLogger('lambda');
    const cause = new Error('rate limited');
    markSilentTRPCErrorLog(cause);
    const error = new TRPCError({ cause, code: 'TOO_MANY_REQUESTS', message: 'rate limited' });

    onError({ error, path: 'aiChat.outputJSON', type: 'mutation' });

    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
