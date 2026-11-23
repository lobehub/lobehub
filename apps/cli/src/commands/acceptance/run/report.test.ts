import { Command } from 'commander';
import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPERATION_TOKEN_REFUSAL } from '../../../api/operationTokenFallback';
import type * as RefreshModule from '../../../auth/refresh';
import { getValidToken } from '../../../auth/refresh';
import type * as SettingsModule from '../../../settings';
import { log } from '../../../utils/logger';
import { attachPlanCommands } from '../plan';
import { attachAcceptanceRunCommands } from '.';
import { reportRefusalGuidance, reportUpsertAction } from './report';

vi.mock('../../../auth/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: vi.fn(),
}));
vi.mock('../../../settings', async (importOriginal) => ({
  ...(await importOriginal<typeof SettingsModule>()),
  resolveServerUrl: () => 'https://app.test',
}));

const jwt = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const operationToken = jwt({ operation_id: 'op_run', purpose: 'hetero-operation', sub: 'user-1' });
const storedLogin = (sub: string) =>
  vi.mocked(getValidToken).mockResolvedValue({
    credentials: { accessToken: jwt({ sub }) },
    status: 'ok',
  });

type Answer = (credential: string | null) => Response;

const body = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status,
  });
const trpcData = (data: unknown) => body(200, { result: { data: superjson.serialize(data) } });
const trpcFailure = (code: string, httpStatus: number, message: string) =>
  body(httpStatus, {
    error: superjson.serialize({ code: -32_001, data: { code, httpStatus }, message }),
  });

const userState = () => trpcData({ settings: { general: { responseLanguage: 'en-US' } } });
const written = () => trpcData({ id: 'vrr_1' });
const runNotFound = () => trpcFailure('NOT_FOUND', 404, 'Verify run not found');

/** `oidcAuth` refusing the run's operation token; a stored login gets `asLogin`. */
const refusingOperationToken =
  (asLogin: () => Response): Answer =>
  (credential) =>
    credential === operationToken
      ? trpcFailure('UNAUTHORIZED', 401, OPERATION_TOKEN_REFUSAL)
      : asLogin();

/**
 * The lambda endpoint, answering each procedure per credential. Returns the
 * credentials each procedure was called with, in order.
 */
const serve = (routes: {
  'user.getUserState': Answer;
  'verify.upsertReport': Answer;
}): Record<string, (string | null)[]> => {
  const sent: Record<string, (string | null)[]> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname.replace('/trpc/lambda/', '');
      const credential = new Headers(init?.headers).get('Oidc-Auth');
      (sent[path] ??= []).push(credential);
      const answer = routes[path as keyof typeof routes];
      return answer ? answer(credential) : trpcFailure('NOT_FOUND', 404, `No procedure ${path}`);
    }),
  );
  return sent;
};

const upsert = () => reportUpsertAction({ run: 'vr_missing', summary: 'probe' });

describe('lh acceptance run report upsert with a run operation token', () => {
  const errors: string[] = [];
  const printed: string[] = [];

  beforeEach(() => {
    errors.length = 0;
    printed.length = 0;
    vi.mocked(getValidToken).mockReset();
    vi.stubEnv('LOBEHUB_JWT', operationToken);
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op_run');
    vi.stubEnv('LOBEHUB_WORKSPACE_ID', 'ws_test');
    vi.spyOn(log, 'error').mockImplementation((line) => void errors.push(line));
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation((line) => void printed.push(String(line)));
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`);
    }) as typeof process.exit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    [
      'on upsertReport, which no operation token reaches',
      { 'user.getUserState': userState, 'verify.upsertReport': refusingOperationToken(written) },
      [operationToken],
    ],
    [
      'on the language check, without acceptance:evidence',
      { 'user.getUserState': refusingOperationToken(userState), 'verify.upsertReport': written },
      undefined,
    ],
  ])(
    'prints what the run can do instead and exits 1 when refused %s',
    async (_case, routes, upsertSentWith) => {
      // Another member's login on a shared device must not stand in for this run.
      storedLogin('user-2');
      const sent = serve(routes);

      await expect(upsert()).rejects.toThrow('process.exit 1');

      expect(sent['verify.upsertReport']).toEqual(upsertSentWith);
      expect(errors).toEqual(reportRefusalGuidance('vr_missing'));
      expect(errors.join('\n')).toContain('lh acceptance plan state op_run');
      expect(errors.join('\n')).toContain('report the handoff as blocked');
      expect(printed).toEqual([]);
    },
  );

  it.each([
    [
      'the round, once the same-account login stood in',
      'Verify run not found',
      refusingOperationToken(runNotFound),
    ],
    [
      'an UNAUTHORIZED with another message',
      'Operation token is bound to another workspace',
      () => trpcFailure('UNAUTHORIZED', 401, 'Operation token is bound to another workspace'),
    ],
  ])('passes any other failure through unchanged: %s', async (_case, message, answer) => {
    storedLogin('user-1');
    serve({ 'user.getUserState': userState, 'verify.upsertReport': answer });

    await expect(upsert()).rejects.toThrow(message);

    expect(process.exit).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('writes the report when the stored login of the same account stands in', async () => {
    storedLogin('user-1');
    const sent = serve({
      'user.getUserState': userState,
      'verify.upsertReport': refusingOperationToken(written),
    });

    await expect(upsert()).resolves.toBeUndefined();

    expect(sent['verify.upsertReport']).toEqual([operationToken, jwt({ sub: 'user-1' })]);
    expect(printed.join('\n')).toContain('vrr_1');
    expect(process.exit).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('names only commands and options the CLI parses', async () => {
    const commands = [
      'plan state op_run',
      'run ingest <reportDir> --operation op_run',
      'run result submit --operation op_run --item <checkItemId> --type <type> --file <path>',
    ];
    const guidance = reportRefusalGuidance('vr_missing').join('\n');

    for (const line of commands) {
      expect(guidance).toContain(`lh acceptance ${line}`);

      const acceptance = new Command('acceptance');
      attachAcceptanceRunCommands(acceptance);
      attachPlanCommands(acceptance);
      const args = line.split(' ');
      let leaf = acceptance;
      for (const name of args) {
        leaf.exitOverride().configureOutput({ writeErr: () => {} });
        const sub = leaf.commands.find((command) => command.name() === name);
        if (!sub) break;
        leaf = sub;
      }
      const reached = vi.fn();
      leaf
        .exitOverride()
        .configureOutput({ writeErr: () => {} })
        .action(reached);

      await acceptance.parseAsync(args, { from: 'user' });
      expect(reached, line).toHaveBeenCalledOnce();
    }
  });
});
