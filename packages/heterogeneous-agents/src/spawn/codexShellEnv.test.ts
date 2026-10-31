import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCodexLobeHubContextArgs,
  createCodexJwtFile,
  LOBEHUB_JWT_FILE_ENV,
  refreshCodexJwtFiles,
  toTomlBasicString,
} from './codexShellEnv';

/** Decode the way Codex does: the `-c` value is a TOML basic string, which is JSON-compatible here. */
const decode = (arg: string) => {
  const [key, ...rest] = arg.split('=');
  return { key, value: JSON.parse(rest.join('=')) as string };
};

describe('toTomlBasicString', () => {
  it('quotes plain ids and URLs so Codex never falls back to raw-string parsing', () => {
    expect(toTomlBasicString('op_123')).toBe('"op_123"');
    expect(toTomlBasicString('https://app.lobehub.com/a?b=c&d=e')).toBe(
      '"https://app.lobehub.com/a?b=c&d=e"',
    );
    // Valid TOML scalars on their own must still arrive as strings.
    expect(toTomlBasicString('123')).toBe('"123"');
    expect(toTomlBasicString('true')).toBe('"true"');
  });

  it('escapes quotes, backslashes and control characters', () => {
    const raw = 'a"b\\c\nd\te\u0000f\u007Fg';
    const encoded = toTomlBasicString(raw);

    expect(encoded).toBe('"a\\"b\\\\c\\u000ad\\u0009e\\u0000f\\u007fg"');
    expect(JSON.parse(encoded)).toBe(raw);
  });
});

describe('buildCodexLobeHubContextArgs', () => {
  it('forwards every present run-context var as a shell_environment_policy.set override', () => {
    const args = buildCodexLobeHubContextArgs({
      LOBEHUB_AGENT_ID: 'agt_1',
      LOBEHUB_ASSISTANT_MESSAGE_ID: 'msg_1',
      LOBEHUB_JWT: 'secret.jwt.token',
      LOBEHUB_OPERATION_ID: 'op_1',
      LOBEHUB_SERVER: 'https://app.lobehub.com',
      LOBEHUB_TASK_ID: 'task_1',
      LOBEHUB_TOPIC_ID: 'tpc_1',
      LOBEHUB_WORKSPACE_ID: '',
      UNRELATED: 'x',
    });

    const flags = args.filter((_, index) => index % 2 === 0);
    expect(new Set(flags)).toEqual(new Set(['-c']));
    expect(args.filter((_, index) => index % 2 === 1).map(decode)).toEqual([
      { key: 'shell_environment_policy.set.LOBEHUB_AGENT_ID', value: 'agt_1' },
      { key: 'shell_environment_policy.set.LOBEHUB_ASSISTANT_MESSAGE_ID', value: 'msg_1' },
      { key: 'shell_environment_policy.set.LOBEHUB_OPERATION_ID', value: 'op_1' },
      { key: 'shell_environment_policy.set.LOBEHUB_SERVER', value: 'https://app.lobehub.com' },
      { key: 'shell_environment_policy.set.LOBEHUB_TASK_ID', value: 'task_1' },
      { key: 'shell_environment_policy.set.LOBEHUB_TOPIC_ID', value: 'tpc_1' },
    ]);
    expect(args.join(' ')).not.toContain('secret.jwt.token');
    expect(args.join(' ')).not.toContain('LOBEHUB_JWT');
  });

  it('returns nothing outside a LobeHub run', () => {
    expect(buildCodexLobeHubContextArgs({ PATH: '/usr/bin' })).toEqual([]);
  });
});

describe('createCodexJwtFile', () => {
  it('writes the token to a private 0600 file and removes it on cleanup', async () => {
    const jwtFile = await createCodexJwtFile('header.payload.sig');
    const dir = path.dirname(jwtFile.path);

    try {
      expect(await readFile(jwtFile.path, 'utf8')).toBe('header.payload.sig');
      if (process.platform !== 'win32') {
        expect((await stat(jwtFile.path)).mode & 0o777).toBe(0o600);
        expect((await stat(dir)).mode & 0o777).toBe(0o700);
      }
      expect(jwtFile.args).toEqual([
        '-c',
        `shell_environment_policy.set.${LOBEHUB_JWT_FILE_ENV}=${JSON.stringify(jwtFile.path)}`,
      ]);
      expect(jwtFile.args.join(' ')).not.toContain('header.payload.sig');
    } finally {
      await jwtFile.cleanup();
    }

    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
    // Idempotent.
    await expect(jwtFile.cleanup()).resolves.toBeUndefined();
  });

  it('rewrites live files with a renewed token and leaves removed ones gone', async () => {
    // A run outliving its operation token: nested `lh` reads the file, not the host env.
    const live = await createCodexJwtFile('old-token');
    const ended = await createCodexJwtFile('old-token');
    await ended.cleanup();

    try {
      await refreshCodexJwtFiles('renewed-token');

      expect(await readFile(live.path, 'utf8')).toBe('renewed-token');
      if (process.platform !== 'win32') {
        expect((await stat(live.path)).mode & 0o777).toBe(0o600);
      }
      await expect(stat(ended.path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await live.cleanup();
    }
  });
});
