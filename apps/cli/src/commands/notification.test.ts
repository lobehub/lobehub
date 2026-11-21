import type { NotificationSettings } from '@lobechat/types';
import { mergeNotificationSettings } from '@lobechat/utils/mergeNotificationSettings';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerNotificationCommand } from './notification';

// A fake server: one personal bag and per-workspace preferences, merged the way
// the real procedures merge them, so assertions read the resulting state.
const { state, mockGetTrpcClient, mockResolveWorkspaceId } = vi.hoisted(() => ({
  mockGetTrpcClient: vi.fn(),
  mockResolveWorkspaceId: vi.fn(),
  state: {
    personal: {} as Record<string, any>,
    workspace: {} as Record<string, Record<string, any>>,
  },
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/workspace', () => ({ resolveWorkspaceId: mockResolveWorkspaceId }));

const clientFor = (workspaceId?: string) => ({
  user: {
    getNotificationSettings: { query: async () => state.personal },
    updateNotificationSettings: {
      mutate: async (patch: NotificationSettings) => {
        state.personal = mergeNotificationSettings(state.personal, patch);
        return state.personal;
      },
    },
  },
  workspaceUserSettings: {
    getPreference: {
      query: async () => ({ notification: state.workspace[workspaceId!] }),
    },
    updatePreference: {
      mutate: async ({ notification }: { notification: NotificationSettings }) => {
        state.workspace[workspaceId!] = mergeNotificationSettings(
          state.workspace[workspaceId!],
          notification,
        );
      },
    },
  },
});

describe('notification command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.personal = {};
    state.workspace = {};
    // Mirror process.exit by aborting the action, so nothing runs past a usage error.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    mockGetTrpcClient.mockImplementation(async (workspaceId?: string) => clientFor(workspaceId));
    mockResolveWorkspaceId.mockImplementation((explicit?: string) => explicit ?? 'ws-current');
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const run = (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerNotificationCommand(program);
    return program.parseAsync(['node', 'test', 'notification', ...args]);
  };

  it('disables a channel without touching its type overrides or other channels', async () => {
    state.personal = {
      email: { items: { billing: { credit_balance_low: false } } },
      inbox: { enabled: true },
    };

    await run('disable', 'email');

    expect(state.personal).toEqual({
      email: { enabled: false, items: { billing: { credit_balance_low: false } } },
      inbox: { enabled: true },
    });
  });

  it('toggles individual types with repeated --type', async () => {
    await run('disable', 'inbox', '--type', 'billing.a', '--type', 'billing.b', '--type', 'x.y');
    await run('enable', 'inbox', '--type', 'billing.a');

    expect(state.personal).toEqual({
      inbox: { items: { billing: { a: true, b: false }, x: { y: false } } },
    });
  });

  it('configures one IM platform and keeps its siblings', async () => {
    state.personal = { im: { platforms: { slack: { enabled: true, tenantId: 'T1' } } } };

    await run('disable', 'im', '--platform', 'telegram');

    expect(state.personal.im.platforms).toEqual({
      slack: { enabled: true, tenantId: 'T1' },
      telegram: { enabled: false },
    });
  });

  it('writes workspace preferences for the current scope, leaving personal settings alone', async () => {
    await run('disable', 'im', '--workspace');
    await run('disable', 'email', '--workspace', 'ws-other');

    expect(state.workspace).toEqual({
      'ws-current': { im: { enabled: false } },
      'ws-other': { email: { enabled: false } },
    });
    expect(state.personal).toEqual({});
  });

  it('fails when --workspace has no workspace to resolve', async () => {
    mockResolveWorkspaceId.mockReturnValue(undefined);

    await expect(run('disable', 'im', '--workspace')).rejects.toThrow('exit 1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No workspace in scope'));
    expect(state.workspace).toEqual({});
  });

  it.each([
    [['disable', 'sms'], 'Unknown channel'],
    [['disable', 'email', '--platform', 'telegram'], 'only applies to the im channel'],
    [['disable', 'im', '--platform', 'telegram', '--workspace'], 'personal setting'],
    [['disable', 'email', '--type', 'billing'], 'Invalid --type'],
    [['update', '--data', '{bad'], 'Invalid notification settings JSON'],
    [['update', '--data', '{"emial":{"enabled":false}}', '--workspace'], 'Invalid notification'],
    [['update', '--data', '{"push":{"enabled":"no"}}'], 'push.enabled'],
  ])('rejects %j without writing', async (args, message) => {
    await expect(run(...args)).rejects.toThrow('exit 1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(state).toEqual({ personal: {}, workspace: {} });
  });

  it('merges an update patch', async () => {
    state.personal = { push: { enabled: false } };

    await run('update', '--data', '{"content":{"scheduledTaskSummary":false}}');

    expect(state.personal).toEqual({
      content: { scheduledTaskSummary: false },
      push: { enabled: false },
    });
  });

  it('prints settings as JSON', async () => {
    state.personal = { email: { enabled: false } };

    await run('settings', '--json');

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ email: { enabled: false } }, null, 2));
  });

  it('lists disabled channels and types in the table', async () => {
    state.personal = {
      email: { enabled: false },
      im: { platforms: { telegram: { items: { billing: { a: false } } } } },
    };

    await run('settings');

    const output = consoleSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Personal notification settings');
    expect(output).toMatch(/email\s+\S*off/);
    expect(output).toMatch(/im:telegram\s+\S*on\S*\s+billing\.a/);
  });
});
