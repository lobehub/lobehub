import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import { clearCredentials } from '../auth/credentials';
import { log } from '../utils/logger';
import { registerLogoutCommand } from './logout';

vi.mock('../auth/credentials', () => ({
  clearCredentials: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('logout command', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerLogoutCommand(program);
    return program;
  }

  it('should log success when credentials are removed', async () => {
    vi.mocked(clearCredentials).mockReturnValue(true);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'logout']);

    expect(clearCredentials).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Logged out'));
  });

  it('should log already logged out when no credentials', async () => {
    vi.mocked(clearCredentials).mockReturnValue(false);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'logout']);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Already logged out'));
  });
});
