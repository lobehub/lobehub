import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    opts: any,
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => {
    try {
      const result = execFileMock(cmd, args, opts);
      cb(null, result);
    } catch (error) {
      cb(error as Error, { stdout: '', stderr: '' });
    }
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@/services/fileSrv', () => ({ default: class {} }));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../libs/mcp/client', () => ({
  MCPClient: class {},
  MCPConnectionError: class extends Error {
    stderrLogs: string[] = [];
  },
}));

import McpCtr from '../McpCtr';

const makeCtr = () => {
  const ctr = new (McpCtr as any)({ getService: () => ({}) });
  return ctr;
};

const callValidate = async (ctr: any, deploymentOptions: any[]) => {
  const payload = { json: { deploymentOptions } };
  const res: any = await ctr.validMcpServerInstallable(payload);
  return res.json;
};

describe('McpCtr.validMcpServerInstallable - CWE-78 hardening', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('does NOT execute attacker-supplied checkCommand strings', async () => {
    const ctr = makeCtr();
    const malicious = "node -e \"require('fs').writeFileSync('/tmp/pwn','x')\"";
    await callValidate(ctr, [
      {
        installationMethod: 'manual',
        systemDependencies: [
          { name: 'node', checkCommand: malicious },
        ],
      },
    ]);

    // execFile must never be invoked with the attacker-supplied command string,
    // and must never be invoked with shell:true.
    for (const call of execFileMock.mock.calls) {
      const [cmd, args, opts] = call;
      expect(cmd).not.toContain('require(');
      expect((args || []).join(' ')).not.toContain('require(');
      expect(opts?.shell).not.toBe(true);
    }
  });

  it('rejects dependency names containing shell metacharacters', async () => {
    const ctr = makeCtr();
    await callValidate(ctr, [
      {
        installationMethod: 'manual',
        systemDependencies: [
          { name: 'node; touch /tmp/pwned' },
          { name: '$(touch /tmp/pwn2)' },
          { name: '`id`' },
          { name: 'a|b' },
        ],
      },
    ]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects npm package names with shell metacharacters', async () => {
    const ctr = makeCtr();
    await callValidate(ctr, [
      {
        installationMethod: 'npm',
        installationDetails: { packageName: 'foo; rm -rf /' },
      },
    ]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects python pythonCommand with shell metacharacters', async () => {
    const ctr = makeCtr();
    await callValidate(ctr, [
      {
        installationMethod: 'python',
        installationDetails: {
          packageName: 'requests',
          pythonCommand: 'python; touch /tmp/pwn',
        },
      },
    ]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('still runs a normal npm dependency check via execFile (no shell)', async () => {
    const ctr = makeCtr();
    execFileMock.mockReturnValue({ stdout: '/usr/lib\n└── left-pad@1.3.0\n', stderr: '' });
    await callValidate(ctr, [
      {
        installationMethod: 'npm',
        installationDetails: { packageName: 'left-pad' },
      },
    ]);
    expect(execFileMock).toHaveBeenCalled();
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe('npm');
    expect(args).toEqual(['list', '-g', 'left-pad', '--depth=0']);
    expect(opts?.shell).not.toBe(true);
  });
});
