import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClaudeSdkExecutablePath } from './claudeAgentSdkSession';

const resolveCliSpawnPlanMock = vi.hoisted(() => vi.fn());

vi.mock('./cliSpawn', () => ({ resolveCliSpawnPlan: resolveCliSpawnPlanMock }));

describe('resolveClaudeSdkExecutablePath', () => {
  beforeEach(() => {
    resolveCliSpawnPlanMock.mockReset();
  });

  it.each(['C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd', 'C:\\tools\\claude.BAT'])(
    'unwraps a Windows Node shim for the Agent SDK: %s',
    async (commandPath) => {
      const scriptPath =
        'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
      resolveCliSpawnPlanMock.mockResolvedValue({
        args: [scriptPath],
        command: 'C:\\Program Files\\nodejs\\node.exe',
      });

      await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
        scriptPath,
      );
      expect(resolveCliSpawnPlanMock).toHaveBeenCalledWith(commandPath, [], process.env);
    },
  );

  it('uses a native executable targeted by a Windows shim', async () => {
    const commandPath = 'C:\\tools\\claude.cmd';
    const executablePath = 'C:\\tools\\claude.exe';
    resolveCliSpawnPlanMock.mockResolvedValue({ args: [], command: executablePath });

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
      executablePath,
    );
  });

  it('reports an unresolved Windows shim before the SDK tries to spawn it', async () => {
    const commandPath = 'C:\\tools\\claude.cmd';
    resolveCliSpawnPlanMock.mockResolvedValue({ args: [], command: commandPath });

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).rejects.toThrow(
      'Unable to resolve the Claude Code Windows shim',
    );
  });

  it('keeps a native Windows executable', async () => {
    const commandPath = 'C:\\tools\\claude.exe';

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'win32')).resolves.toBe(
      commandPath,
    );
    expect(resolveCliSpawnPlanMock).not.toHaveBeenCalled();
  });

  it('keeps the detected executable on other platforms', async () => {
    const commandPath = '/opt/homebrew/bin/claude';

    await expect(resolveClaudeSdkExecutablePath(commandPath, process.env, 'darwin')).resolves.toBe(
      commandPath,
    );
    expect(resolveCliSpawnPlanMock).not.toHaveBeenCalled();
  });
});
