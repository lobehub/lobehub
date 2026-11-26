import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashStdioLaunch, isStdioLaunchTrusted, trustStdioLaunch } from './stdioTrust';

const tmpHome = path.join(os.tmpdir(), 'lobehub-cli-test-stdio-trust');

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: () => path.join(actual.default.tmpdir(), 'lobehub-cli-test-stdio-trust'),
    },
  };
});

describe('stdioTrust', () => {
  afterEach(() => {
    fs.rmSync(tmpHome, { force: true, recursive: true });
  });

  const launch = { args: ['-y', 'srv'], command: 'npx', env: { A: '1' } };

  it('trusts only the exact command, argv and env that were approved', () => {
    expect(isStdioLaunchTrusted('s#1', launch)).toBe(false);

    trustStdioLaunch('s#1', launch);

    expect(isStdioLaunchTrusted('s#1', launch)).toBe(true);
    expect(isStdioLaunchTrusted('s#2', launch)).toBe(false);
    expect(isStdioLaunchTrusted('s#1', { ...launch, command: 'sh' })).toBe(false);
    expect(isStdioLaunchTrusted('s#1', { ...launch, args: ['-c', 'evil'] })).toBe(false);
    expect(isStdioLaunchTrusted('s#1', { ...launch, env: { A: '1', NODE_OPTIONS: 'x' } })).toBe(
      false,
    );
  });

  it('ignores env key order', () => {
    expect(hashStdioLaunch({ command: 'x', env: { A: '1', B: '2' } })).toBe(
      hashStdioLaunch({ command: 'x', env: { B: '2', A: '1' } }),
    );
  });
});
