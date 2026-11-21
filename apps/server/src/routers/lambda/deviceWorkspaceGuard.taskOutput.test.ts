import { describe, expect, it, vi } from 'vitest';

import type { DeviceModel } from '@/database/models/device';

import {
  assertWorkspaceRootApproved,
  claudeCodeProjectKey,
  isClaudeCodeTaskOutputDir,
} from './deviceWorkspaceGuard';

const SESSION = '6dd6da3d-4cce-4776-b75b-3bea0332796d';
const ROOT = '/Users/me/proj';
const tasksDir = (cwd: string, tmp = '/private/tmp/claude-501') =>
  `${tmp}/${claudeCodeProjectKey(cwd)}/${SESSION}/tasks`;

const model = (workingDirs: string[]) =>
  ({
    findByDeviceId: vi
      .fn()
      .mockResolvedValue({ workingDirs: workingDirs.map((path) => ({ path })) }),
  }) as unknown as DeviceModel;

describe('Claude Code background task output grant', () => {
  it('keys a project the way Claude Code names its directory', () => {
    // Recorded from claude 2.1.308: cwd `/private/tmp/claude-501/-Users-…/scratchpad/ws`.
    expect(claudeCodeProjectKey('/private/tmp/claude-501/-Users-me/.claude/ws')).toBe(
      '-private-tmp-claude-501--Users-me--claude-ws',
    );
  });

  it('lets a preview read the tasks directory of an approved project', async () => {
    await expect(
      assertWorkspaceRootApproved(model([ROOT]), 'dev-1', tasksDir(ROOT)),
    ).resolves.toBeUndefined();
    expect(isClaudeCodeTaskOutputDir(`${tasksDir(ROOT)}/`, [ROOT])).toBe(true);
    expect(isClaudeCodeTaskOutputDir(tasksDir(ROOT, '/tmp/claude-0'), [ROOT])).toBe(true);
  });

  it('matches a macOS /tmp root through /private', () => {
    expect(isClaudeCodeTaskOutputDir(tasksDir('/private/tmp/ws'), ['/tmp/ws'])).toBe(true);
    expect(isClaudeCodeTaskOutputDir(tasksDir('/tmp/ws'), ['/private/tmp/ws'])).toBe(true);
  });

  it('refuses the tasks directory of a project that is not approved', async () => {
    await expect(
      assertWorkspaceRootApproved(model([ROOT]), 'dev-1', tasksDir('/Users/me/other')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A sibling whose key only starts with the approved one is a different project.
    expect(isClaudeCodeTaskOutputDir(tasksDir(`${ROOT}-evil`), [ROOT])).toBe(false);
  });

  it('refuses anything but the session tasks directory itself', () => {
    const base = `/private/tmp/claude-501/${claudeCodeProjectKey(ROOT)}`;
    expect(isClaudeCodeTaskOutputDir(base, [ROOT])).toBe(false);
    expect(isClaudeCodeTaskOutputDir(`${base}/${SESSION}`, [ROOT])).toBe(false);
    expect(isClaudeCodeTaskOutputDir(`${base}/${SESSION}/tasks/nested`, [ROOT])).toBe(false);
    expect(isClaudeCodeTaskOutputDir(`${base}/not-a-session/tasks`, [ROOT])).toBe(false);
    expect(isClaudeCodeTaskOutputDir(`${base}/${SESSION}/../${SESSION}/tasks`, [ROOT])).toBe(false);
    expect(isClaudeCodeTaskOutputDir(`relative/claude-1/x/${SESSION}/tasks`, [ROOT])).toBe(false);
  });
});
