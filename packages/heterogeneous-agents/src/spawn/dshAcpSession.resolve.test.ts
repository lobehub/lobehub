import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DSH_MIN_VERSION, resolveDshSpawnCommand } from './dshAcpSession';

const { detectValidatedCommand } = vi.hoisted(() => ({ detectValidatedCommand: vi.fn() }));

// The WSL fallback only runs on Windows; here it hands the native result back.
vi.mock('./resolveCliCommand', () => ({
  detectInWslWhenMissing: async (status: unknown) => status,
  detectValidatedCommandCandidates: detectValidatedCommand,
}));

describe('resolveDshSpawnCommand', () => {
  beforeEach(() => detectValidatedCommand.mockReset());

  it('launches the validated dsh with the PATH that found it', async () => {
    // Installed after the host started: only the re-read PATH has it.
    detectValidatedCommand.mockResolvedValue({
      available: true,
      path: 'C:\\Users\\x\\AppData\\Roaming\\npm\\dsh.cmd',
      resolvedPathEnv: 'C:\\Users\\x\\AppData\\Roaming\\npm;C:\\Windows',
      version: DSH_MIN_VERSION,
    });
    const env = { PATH: 'C:\\Windows' };

    await expect(resolveDshSpawnCommand(undefined, env)).resolves.toEqual({
      command: 'C:\\Users\\x\\AppData\\Roaming\\npm\\dsh.cmd',
      pathEnv: 'C:\\Users\\x\\AppData\\Roaming\\npm;C:\\Windows',
      version: DSH_MIN_VERSION,
    });
    expect(detectValidatedCommand).toHaveBeenCalledWith(['dsh'], expect.any(Object), env);
  });

  it('falls back to the bare command when detection fails or finds an old CLI', async () => {
    detectValidatedCommand.mockRejectedValueOnce(new Error('probe crashed'));
    await expect(resolveDshSpawnCommand('dsh')).resolves.toEqual({ command: 'dsh' });

    detectValidatedCommand.mockResolvedValueOnce({
      available: true,
      path: '/old/dsh',
      version: '0.0.1',
    });
    await expect(resolveDshSpawnCommand()).resolves.toEqual({ command: 'dsh' });
  });

  it('uses a custom command verbatim without probing', async () => {
    await expect(resolveDshSpawnCommand(' /opt/dsh-wrapped ')).resolves.toEqual({
      command: '/opt/dsh-wrapped',
    });
    expect(detectValidatedCommand).not.toHaveBeenCalled();
  });
});
