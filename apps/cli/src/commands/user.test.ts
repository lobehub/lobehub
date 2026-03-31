import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerUserCommand } from './user';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    user: {
      getUserRegistrationDuration: { query: vi.fn() },
      updateAvatar: { mutate: vi.fn() },
      updateFullName: { mutate: vi.fn() },
      updatePreference: { mutate: vi.fn() },
      updateSettings: { mutate: vi.fn() },
      updateUsername: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('user command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const method of Object.values(mockTrpcClient.user)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerUserCommand(program);
    return program;
  }

  describe('info', () => {
    it('should display registration duration', async () => {
      const durationMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      mockTrpcClient.user.getUserRegistrationDuration.query.mockResolvedValue(durationMs);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'user', 'info']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('30'));
    });

    it('should output JSON', async () => {
      mockTrpcClient.user.getUserRegistrationDuration.query.mockResolvedValue(86400000);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'user', 'info', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(86400000, null, 2));
    });
  });

  describe('settings', () => {
    it('should update settings', async () => {
      mockTrpcClient.user.updateSettings.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'user', 'settings', '--data', '{"language":"en"}']);

      expect(mockTrpcClient.user.updateSettings.mutate).toHaveBeenCalledWith({ language: 'en' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Settings updated'));
    });

    it('should reject invalid JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'user', 'settings', '--data', 'not-json']);

      expect(log.error).toHaveBeenCalledWith('Invalid settings JSON.');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('preferences', () => {
    it('should update preferences', async () => {
      mockTrpcClient.user.updatePreference.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'user',
        'preferences',
        '--data',
        '{"theme":"dark"}',
      ]);

      expect(mockTrpcClient.user.updatePreference.mutate).toHaveBeenCalledWith({ theme: 'dark' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Preferences updated'));
    });

    it('should reject invalid JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'user', 'preferences', '--data', '{bad}']);

      expect(log.error).toHaveBeenCalledWith('Invalid preferences JSON.');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('update-avatar', () => {
    it('should update avatar', async () => {
      mockTrpcClient.user.updateAvatar.mutate.mockResolvedValue({ avatar: 'new-url' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'user',
        'update-avatar',
        'https://example.com/avatar.png',
      ]);

      expect(mockTrpcClient.user.updateAvatar.mutate).toHaveBeenCalledWith(
        'https://example.com/avatar.png',
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Avatar updated'));
    });

    it('should output JSON', async () => {
      const result = { avatar: 'new-url' };
      mockTrpcClient.user.updateAvatar.mutate.mockResolvedValue(result);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'user',
        'update-avatar',
        'https://example.com/avatar.png',
        '--json',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });
  });

  describe('update-name', () => {
    it('should update full name', async () => {
      mockTrpcClient.user.updateFullName.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'user', 'update-name', '--full-name', 'John Doe']);

      expect(mockTrpcClient.user.updateFullName.mutate).toHaveBeenCalledWith('John Doe');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Full name updated'));
    });

    it('should update username', async () => {
      mockTrpcClient.user.updateUsername.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'user', 'update-name', '--username', 'johndoe']);

      expect(mockTrpcClient.user.updateUsername.mutate).toHaveBeenCalledWith('johndoe');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Username updated'));
    });

    it('should error when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'user', 'update-name']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
