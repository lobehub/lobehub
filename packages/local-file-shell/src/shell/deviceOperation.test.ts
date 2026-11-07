import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import { executeDeviceOperation, registerDeviceOperationResource } from './deviceOperation';
import { ShellProcessManager } from './process-manager';
import { runCommand } from './runner';

const unused = async () => ({ content: 'Unexpected lifecycle dispatch', success: false });
const begin = (operationId: string) =>
  executeDeviceOperation({ apiName: 'beginNativeOperation', operationId }, unused);
const cancel = (operationId: string) =>
  executeDeviceOperation({ apiName: 'cancelNativeOperation', operationId }, unused);

describe('Native device operation lifetime', () => {
  it('refuses a Native scope on Windows, where exit cannot be confirmed', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      expect(await begin('windows')).toMatchObject({
        state: { registered: false },
        success: false,
      });
      // No scope was created, so nothing can later wait on an unprovable exit.
      expect((await cancel('windows')).success).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('fences delayed calls and does not acknowledge an unknown/restarted operation', async () => {
    expect((await cancel('missing')).success).toBe(false);
    await begin('delayed');
    expect(await cancel('delayed')).toMatchObject({ state: { exited: true }, success: true });
    const execute = vi.fn().mockResolvedValue({ content: '', success: true });
    expect(
      await executeDeviceOperation({ apiName: 'writeFile', operationId: 'delayed' }, execute),
    ).toMatchObject({ success: false });
    expect(execute).not.toHaveBeenCalled();
    expect((await begin('delayed')).success).toBe(false);
  });

  it('waits for an in-flight tool that registers a resource after cancellation', async () => {
    await begin('in-flight');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const terminate = vi.fn().mockResolvedValue(true);
    const tool = executeDeviceOperation(
      { apiName: 'runCommand', operationId: 'in-flight' },
      async () => {
        await gate;
        registerDeviceOperationResource(terminate);
        return { content: '', success: true };
      },
    );
    let acknowledged = false;
    const stopped = cancel('in-flight').then((result) => {
      acknowledged = true;
      return result;
    });
    await delay(75);
    expect(acknowledged).toBe(false);
    finish();
    await tool;
    expect(await stopped).toMatchObject({ state: { exited: true } });
    expect(terminate).toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')(
    'stops a real background writer before acknowledgement and leaves another operation alone',
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'native-operation-'));
      const manager = new ShellProcessManager(path.join(directory, 'output'));
      const ids = ['writer-a', 'writer-b'];
      const start = async (operationId: string) => {
        await begin(operationId);
        const output = path.join(directory, operationId);
        const script = `const fs=require("fs");fs.writeFileSync(${JSON.stringify(output + '.pid')},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(output)},"tick\\n"),25)`;
        return executeDeviceOperation({ apiName: 'runCommand', operationId }, async () => {
          const result = await runCommand(
            { command: `"${process.execPath}" -e '${script}'`, run_in_background: true },
            { processManager: manager },
          );
          return { content: '', state: result, success: result.success };
        });
      };
      try {
        await Promise.all(ids.map(start));
        await vi.waitFor(async () =>
          expect((await stat(path.join(directory, 'writer-a'))).size).toBeGreaterThan(0),
        );
        const pid = Number(await readFile(path.join(directory, 'writer-a.pid'), 'utf8'));
        const otherPid = Number(await readFile(path.join(directory, 'writer-b.pid'), 'utf8'));
        expect(await cancel('writer-a')).toMatchObject({ success: true, state: { exited: true } });
        expect(() => process.kill(pid, 0)).toThrow();
        expect(() => process.kill(otherPid, 0)).not.toThrow();
        const size = (await stat(path.join(directory, 'writer-a'))).size;
        await delay(75);
        expect((await stat(path.join(directory, 'writer-a'))).size).toBe(size);
      } finally {
        await Promise.all(ids.map(cancel));
        manager.cleanupAll();
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});
