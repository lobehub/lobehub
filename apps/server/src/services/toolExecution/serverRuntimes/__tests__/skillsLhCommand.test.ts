// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { preprocessSkillSandboxCommand } from '../skillsLhCommand';

const mocks = vi.hoisted(() => ({ isLhCommand: vi.fn(), preprocessLhCommand: vi.fn() }));

vi.mock('@/server/services/toolExecution/preprocessLhCommand', () => ({
  isLhCommand: mocks.isLhCommand,
  preprocessLhCommand: mocks.preprocessLhCommand,
}));

const scope = {
  deviceAccessDenied: false,
  operationId: 'op-1',
  resolveWorkspaceId: vi.fn(async () => 'workspace-1'),
  shareVisitorBlocked: false,
  userId: 'user-1',
};

describe('preprocessSkillSandboxCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preprocessLhCommand.mockResolvedValue({ command: 'prefixed', error: undefined });
  });

  it('recovers the workspace scope for an lh command when the context lost it', async () => {
    mocks.isLhCommand.mockReturnValue(true);

    await expect(preprocessSkillSandboxCommand('lh agent edit agt_1', scope)).resolves.toEqual({
      command: 'prefixed',
      error: undefined,
    });
    expect(scope.resolveWorkspaceId).toHaveBeenCalledTimes(1);
    expect(mocks.preprocessLhCommand).toHaveBeenCalledWith(
      'lh agent edit agt_1',
      'user-1',
      'workspace-1',
      false,
      'op-1',
      false,
    );
  });

  it("hands on the run's device denial, so its token carries it", async () => {
    mocks.isLhCommand.mockReturnValue(false);

    await preprocessSkillSandboxCommand('ls', { ...scope, deviceAccessDenied: true });

    expect(scope.resolveWorkspaceId).not.toHaveBeenCalled();
    expect(mocks.preprocessLhCommand.mock.calls[0][5]).toBe(true);
  });
});
