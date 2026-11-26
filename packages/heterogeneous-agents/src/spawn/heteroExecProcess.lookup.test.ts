import { execFile } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findOperationProcessGroups } from './heteroExecProcess';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const OP = 'op_1794770086953_agt_rLAvknmr79ZX_tpc_2ueCKYvSid8g_QA3hXw4N';

type Callback = (error: Error | null, stdout: string) => void;

/** Answers each `ps` call by its arguments; `undefined` simulates a timeout kill. */
const answerPs = (respond: (args: string[]) => string | undefined) =>
  vi.mocked(execFile).mockImplementation(((_file: string, args: string[], _opts, callback) => {
    const output = respond(args);
    (callback as Callback)(
      output === undefined
        ? Object.assign(new Error(`Command failed: ps ${args.join(' ')}`), {
            killed: true,
            signal: 'SIGTERM',
          })
        : null,
      output ?? '',
    );
  }) as unknown as typeof execFile);

const psArgs = () => vi.mocked(execFile).mock.calls.map((call) => call[1] as string[]);

describe('findOperationProcessGroups on macOS', () => {
  const platform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
  });

  it('kills a live wrapper without reading process environments', async () => {
    answerPs((args) =>
      args.includes('-E')
        ? undefined
        : [
            `64656 64656 bun lh hetero exec --type claude-code --operation-id ${OP}`,
            '65137 64656 claude -p',
          ].join('\n'),
    );

    await expect(findOperationProcessGroups(OP)).resolves.toEqual([64656]);
    expect(psArgs()).toEqual([['-A', '-ww', '-o', 'pid=,pgid=,args=']]);
  });

  it("reads only this user's environments once the wrapper is gone", async () => {
    answerPs((args) =>
      args.includes('-E')
        ? `65137 64656 claude -p LOBEHUB_OPERATION_ID=${OP}`
        : '65137 64656 claude -p\n70000 70000 vim',
    );

    await expect(findOperationProcessGroups(OP)).resolves.toEqual([64656]);
    expect(psArgs()[1]).toEqual([
      '-U',
      String(process.getuid!()),
      '-E',
      '-ww',
      '-o',
      'pid=,pgid=,args=',
    ]);
  });

  it('rejects with the timeout named when ps is killed', async () => {
    answerPs(() => undefined);

    await expect(findOperationProcessGroups(OP)).rejects.toThrow(/timed out after 2000ms/);
  });
});
