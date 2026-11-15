import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectOperationProcessGroups,
  findOperationProcessGroups,
  isHeteroExecCommandFor,
  parseHeteroExecProcesses,
  parsePsOperationCandidates,
  readProcfsOperationCandidates,
} from './heteroExecProcess';

const OP = 'op_1789469228314_agt_wTVg1V72zhow_tpc_hLx07QnXKl3Y_Ft2WdCfP';

describe('heteroExecProcess', () => {
  it('matches the packaged desktop wrapper argv for the operation', () => {
    expect(
      isHeteroExecCommandFor(
        `/Applications/LobeHub.app/Contents/MacOS/LobeHub /Applications/LobeHub.app/Contents/Resources/bin/lobe-cli.js hetero exec --type kimi-code --operation-id ${OP} --topic tpc_hLx07QnXKl3Y --render none --input-json - --cwd /tmp/work`,
        OP,
      ),
    ).toBe(true);
    expect(isHeteroExecCommandFor(`node lh.js hetero exec --operation-id=${OP}`, OP)).toBe(true);
  });

  it('ignores other operations, prefixes and non-exec commands', () => {
    expect(isHeteroExecCommandFor(`lh hetero exec --operation-id ${OP}-2`, OP)).toBe(false);
    expect(isHeteroExecCommandFor(`lh hetero exec --operation-id op_other`, OP)).toBe(false);
    expect(isHeteroExecCommandFor(`lh topic view --operation-id ${OP}`, OP)).toBe(false);
    expect(isHeteroExecCommandFor(`--operation-id ${OP} hetero exec`, OP)).toBe(false);
    expect(isHeteroExecCommandFor('kimi-code', OP)).toBe(false);
    expect(isHeteroExecCommandFor(`lh hetero exec --operation-id ${OP}`, '')).toBe(false);
  });

  it('parses ps output and skips the current process', () => {
    const output = [
      `  85278 /Applications/LobeHub.app/Contents/MacOS/LobeHub lobe-cli.js hetero exec --type kimi-code --operation-id ${OP} --topic t`,
      '  85296 kimi-code    ',
      `    100 node lh.js hetero exec --operation-id ${OP}`,
      '',
    ].join('\n');

    expect(parseHeteroExecProcesses(output, OP, 100)).toEqual([{ pid: 85278 }]);
    expect(parseHeteroExecProcesses(output, 'op_missing', 100)).toEqual([]);
  });
});

describe('operation process groups', () => {
  it('matches the wrapper argv and descendants carrying the operation env', () => {
    const candidates = [
      { commandLine: `node lh.js hetero exec --operation-id ${OP}`, pgid: 500, pid: 500 },
      // Native agent whose wrapper already died: only its env names the run.
      { commandLine: 'claude --print', env: [`LOBEHUB_OPERATION_ID=${OP}`], pgid: 500, pid: 501 },
      { commandLine: 'bash -c build', env: [`LOBEHUB_OPERATION_ID=${OP}`], pgid: 700, pid: 702 },
      { commandLine: 'claude', env: [`LOBEHUB_OPERATION_ID=${OP}-2`], pgid: 800, pid: 801 },
      { commandLine: 'unrelated', env: [], pgid: 900, pid: 901 },
    ];

    expect(collectOperationProcessGroups(candidates, OP, { pid: 1 })).toEqual([500, 700]);
  });

  it('never returns the caller or its own process group', () => {
    const marker = [`LOBEHUB_OPERATION_ID=${OP}`];
    const candidates = [
      { commandLine: 'lh connect', env: marker, pgid: 40, pid: 41 },
      { commandLine: 'claude', env: marker, pgid: 40, pid: 42 },
    ];

    expect(collectOperationProcessGroups(candidates, OP, { pgid: 40, pid: 41 })).toEqual([]);
  });

  it('reads ownership from the ps -E environment, never from argv', () => {
    const argsOnly = [
      `  85296 85278 claude --print`,
      // An unrelated process that merely mentions the marker in its arguments.
      `  85310 85310 grep LOBEHUB_OPERATION_ID=${OP}`,
      '  85320 85320 kimi-code    ',
      'garbage',
    ].join('\n');
    const withEnv = [
      `  85296 85278 claude --print HOME=/Users/me LOBEHUB_OPERATION_ID=${OP} PATH=/bin`,
      `  85310 85310 grep LOBEHUB_OPERATION_ID=${OP} HOME=/Users/me`,
      `  85320 85320 kimi-code LOBEHUB_OPERATION_ID=${OP}`,
    ].join('\n');

    const candidates = parsePsOperationCandidates(argsOnly, withEnv);

    expect(collectOperationProcessGroups(candidates, OP, { pid: 1 })).toEqual([85278, 85320]);
  });

  describe('Linux procfs', () => {
    let root: string;
    const proc = async (pid: number, stat: string, cmdline: string[], env: string[] = []) => {
      await mkdir(path.join(root, String(pid)));
      await writeFile(path.join(root, String(pid), 'stat'), stat);
      await writeFile(path.join(root, String(pid), 'cmdline'), cmdline.join('\0'));
      await writeFile(path.join(root, String(pid), 'environ'), env.join('\0'));
    };
    const failing =
      (suffix: string, code: string) =>
      async (file: string): Promise<string> => {
        if (file.endsWith(suffix)) throw Object.assign(new Error(code), { code });
        return readFile(file, 'utf8');
      };

    beforeEach(async () => {
      root = await mkdtemp(path.join(os.tmpdir(), 'procfs-'));
      await proc(10, '10 (my (agent)) S 1 10 10 0', ['claude'], [`LOBEHUB_OPERATION_ID=${OP}`]);
      await proc(11, '11 (node) S 1 11 11 0', [
        'node',
        'lh.js',
        'hetero',
        'exec',
        '--operation-id',
        OP,
      ]);
      await proc(12, '12 (grep) S 1 12 12 0', ['grep', `LOBEHUB_OPERATION_ID=${OP}`]);
      await mkdir(path.join(root, 'self'));
    });

    afterEach(async () => {
      await rm(root, { force: true, recursive: true });
    });

    it('matches env and wrapper argv, parsing comm names with spaces', async () => {
      const candidates = await readProcfsOperationCandidates(root);

      expect(collectOperationProcessGroups(candidates, OP, { pid: 1 })).toEqual([10, 11]);
    });

    it("still matches a wrapper by argv when another user's environ is denied", async () => {
      const candidates = await readProcfsOperationCandidates(root, failing('11/environ', 'EACCES'));

      expect(collectOperationProcessGroups(candidates, OP, { pid: 1 })).toEqual([10, 11]);
    });

    it('skips a process that exits while being read', async () => {
      const candidates = await readProcfsOperationCandidates(root, failing('10/environ', 'ENOENT'));

      expect(collectOperationProcessGroups(candidates, OP, { pid: 1 })).toEqual([11]);
    });

    it('rejects instead of skipping a process it failed to read', async () => {
      await expect(
        readProcfsOperationCandidates(root, failing('10/environ', 'EIO')),
      ).rejects.toMatchObject({ code: 'EIO' });
    });
  });

  it.skipIf(process.platform === 'win32')(
    'finds a live agent whose wrapper is gone through its inherited env',
    async () => {
      const operationId = `op_test_${process.pid}_${Date.now()}`;
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        detached: true,
        env: { ...process.env, LOBEHUB_OPERATION_ID: operationId },
        stdio: 'ignore',
      });
      // Unrelated process that only mentions the marker in its arguments.
      const decoy = spawn(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 30000)', `LOBEHUB_OPERATION_ID=${operationId}`],
        { detached: true, stdio: 'ignore' },
      );
      try {
        await Promise.all(
          [child, decoy].map((proc) => new Promise((resolve) => proc.once('spawn', resolve))),
        );

        await expect(findOperationProcessGroups(operationId)).resolves.toEqual([child.pid]);
      } finally {
        process.kill(-child.pid!, 'SIGKILL');
        process.kill(-decoy.pid!, 'SIGKILL');
      }
      await expect(findOperationProcessGroups(`${operationId}-missing`)).resolves.toEqual([]);
    },
  );
});
