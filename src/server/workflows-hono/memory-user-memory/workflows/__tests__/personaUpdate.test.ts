import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkGuard: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/memory/userMemory/persona/service', () => ({
  buildUserPersonaJobInput: vi.fn(),
  UserPersonaService: vi.fn(),
}));

vi.mock('../runGuard', () => ({
  checkGuard: mocks.checkGuard,
}));

const { personaUpdateHandler } = await import('../personaUpdate');

describe('personaUpdateHandler run guard', () => {
  beforeEach(() => {
    mocks.checkGuard.mockReset();
  });

  it('checks the run guard before parsing payload', async () => {
    /**
     * @example
     * await expect(personaUpdateHandler(context)).resolves.toMatchObject({ skipped: true });
     */
    mocks.checkGuard.mockResolvedValue({
      block: {
        matchedKey: 'workflow:run-guard:global',
        reason: 'maintenance',
        scope: 'global',
      },
      response: {
        message: 'Memory workflow disabled by run guard (maintenance); skipping.',
        processedUsers: 0,
        skipped: true,
      },
      result: false,
    });

    const context = {
      requestPayload: { userIds: ['user-1'] },
      run: vi.fn((_name: string, callback: () => unknown) => callback()),
      workflowRunId: 'wfr_persona',
    };

    await expect(personaUpdateHandler(context as never)).resolves.toEqual({
      message: 'Memory workflow disabled by run guard (maintenance); skipping.',
      processedUsers: 0,
      skipped: true,
    });

    expect(context.run).not.toHaveBeenCalled();
    expect(mocks.checkGuard).toHaveBeenCalledWith(
      context,
      'api/workflows/memory-user-memory/pipelines/persona/update-writing',
      { response: { processedUsers: 0 } },
    );
  });
});
