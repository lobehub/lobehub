import type { Operation, TRPCLink } from '@trpc/client';
import { createTRPCClient, TRPCClientError } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RefreshModule from '../auth/refresh';
import type { TokenLookup } from '../auth/refresh';
import { describeTokenLookup, getValidToken } from '../auth/refresh';
import { log } from '../utils/logger';
import {
  isOperationToken,
  OPERATION_TOKEN_REFUSAL,
  operationTokenFallbackLink,
  operationTokenHeaders,
} from './operationTokenFallback';

vi.mock('../auth/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ log: { debug: vi.fn(), warn: vi.fn() } }));

const jwt = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const operationToken = jwt({ purpose: 'hetero-operation', sub: 'user-1' });
const storedLogin = (sub: string) =>
  vi.mocked(getValidToken).mockResolvedValue({
    credentials: { accessToken: jwt({ sub }) },
    status: 'ok',
  });

const trpcError = (message: string, code: string) =>
  new TRPCClientError(message, {
    result: { error: { code: -32_001, data: { code }, message } },
  } as any);

/**
 * A terminating link standing in for `httpLink`: it resolves the request's
 * headers the same way, then answers with whatever the server would.
 */
const serverLink =
  (respond: (authorization: string) => unknown): TRPCLink<AnyRouter> =>
  () =>
  ({ op }) =>
    observable((observer) => {
      const headers = operationTokenHeaders(() => operationToken)({ op: op as Operation });
      const outcome = respond(headers['Oidc-Auth']);
      if (outcome instanceof Error) observer.error(outcome as TRPCClientError<AnyRouter>);
      else {
        observer.next({ result: { data: outcome, type: 'data' } } as any);
        observer.complete();
      }
    });

const query = (respond: (authorization: string) => unknown) => {
  const client = createTRPCClient<AnyRouter>({
    links: [operationTokenFallbackLink(() => operationToken), serverLink(respond)],
  }) as any;
  return client.doc.list.query();
};

/** Refuses the operation token the way `oidcAuth` does; accepts anything else. */
const userScopedRoute = vi.fn((authorization: string) =>
  authorization === operationToken
    ? trpcError(OPERATION_TOKEN_REFUSAL, 'UNAUTHORIZED')
    : `served for ${authorization}`,
);

describe('operation token fallback', () => {
  beforeEach(() => {
    vi.mocked(getValidToken).mockReset();
    vi.mocked(log.warn).mockClear();
    userScopedRoute.mockClear();
  });

  it('recognises only server-minted operation tokens', () => {
    expect(isOperationToken(operationToken)).toBe(true);
    expect(isOperationToken(jwt({ purpose: 'cli-sandbox', sub: 'user-1' }))).toBe(false);
    expect(isOperationToken('not-a-jwt')).toBe(false);
  });

  it("retries a user-scoped request with the machine's login of the same account", async () => {
    storedLogin('user-1');

    await expect(query(userScopedRoute)).resolves.toBe(`served for ${jwt({ sub: 'user-1' })}`);
    expect(userScopedRoute).toHaveBeenCalledTimes(2);
  });

  it('keeps the operation token on endpoints that accept it', async () => {
    storedLogin('user-1');

    await expect(query(() => 'ingested')).resolves.toBe('ingested');
    expect(getValidToken).not.toHaveBeenCalled();
  });

  /**
   * A workspace device is reachable by every member, so the login saved on it
   * can be another member's. Borrowing it would act on that person's data.
   */
  it("never borrows another account's login, and says why", async () => {
    storedLogin('device-owner');

    await expect(query(userScopedRoute)).rejects.toThrow(OPERATION_TOKEN_REFUSAL);
    expect(userScopedRoute).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('no stored login of the same account'),
    );
  });

  it('fails as before when the machine has no login', async () => {
    vi.mocked(getValidToken).mockResolvedValue({ status: 'no-login' });

    await expect(query(userScopedRoute)).rejects.toThrow(OPERATION_TOKEN_REFUSAL);
    expect(userScopedRoute).toHaveBeenCalledTimes(1);
  });

  /** The run did carry a token, so "the run passed no sign-in" would misstate the cause. */
  it('keeps the operation-token wording inside an agent run with no machine login', async () => {
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'tpc_1');
    vi.mocked(getValidToken).mockResolvedValue({ status: 'no-login' });

    await expect(query(userScopedRoute)).rejects.toThrow(OPERATION_TOKEN_REFUSAL);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('no stored login of the same account'),
    );
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('passed no LobeHub sign-in'));
    vi.unstubAllEnvs();
  });

  it.each([
    { detail: 'HTTP 502', status: 'unavailable' },
    { detail: 'invalid_client', status: 'refused' },
    { detail: 'invalid_grant', status: 'spent' },
  ] satisfies TokenLookup[])(
    'explains a $status refresh failure without retrying',
    async (result) => {
      vi.mocked(getValidToken).mockResolvedValue(result);
      const report = describeTokenLookup(result)!;

      await expect(query(userScopedRoute)).rejects.toThrow(OPERATION_TOKEN_REFUSAL);
      expect(userScopedRoute).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(`${report.detail} ${report.fix}`);
      expect(log.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('no stored login of the same account'),
      );
    },
  );

  it('reports unexpected credential lookup errors instead of claiming there is no login', async () => {
    vi.mocked(getValidToken).mockRejectedValue(new Error('credential store unavailable'));

    await expect(query(userScopedRoute)).rejects.toThrow(OPERATION_TOKEN_REFUSAL);
    expect(userScopedRoute).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not look up the stored login'),
    );
    expect(log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('no stored login of the same account'),
    );
  });

  it('does not retry other authentication errors', async () => {
    storedLogin('user-1');
    const expiredToken = vi.fn(() => trpcError('jwt expired', 'UNAUTHORIZED'));

    await expect(query(expiredToken)).rejects.toThrow('jwt expired');
    expect(expiredToken).toHaveBeenCalledTimes(1);
  });

  /**
   * A device run's `caller:act` token is accepted on user-scoped routes, and
   * refused only outside the run's workspace or after the run ended. Those
   * limits are the run's own, so the machine's login, even of the same
   * account, must not lift them.
   */
  it("keeps a caller token's scope and end refusals instead of retrying them", async () => {
    storedLogin('user-1');
    const outOfScope = vi.fn(() =>
      trpcError(
        "This run's token only works in workspace ws-team, not in workspace ws-other.",
        'FORBIDDEN',
      ),
    );
    const ended = vi.fn(() =>
      trpcError('This run has ended, so its token no longer works.', 'UNAUTHORIZED'),
    );

    await expect(query(outOfScope)).rejects.toThrow('only works in workspace ws-team');
    await expect(query(ended)).rejects.toThrow('This run has ended');
    expect(outOfScope).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
