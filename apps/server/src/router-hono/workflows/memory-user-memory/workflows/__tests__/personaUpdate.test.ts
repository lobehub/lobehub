import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildUserPersonaJobInput: vi.fn(),
  checkGuard: vi.fn(),
  composeWriting: vi.fn(),
  ensureWorkflowStarted: vi.fn(),
  getServerDB: vi.fn(),
  isHourlyMemoryExtractionCancellationRequested: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/server/services/memory/userMemory/persona/service', () => ({
  buildUserPersonaJobInput: mocks.buildUserPersonaJobInput,
  UserPersonaService: vi.fn(() => ({ composeWriting: mocks.composeWriting })),
}));

vi.mock('../runGuard', () => ({
  checkGuard: mocks.checkGuard,
  ensureWorkflowStarted: mocks.ensureWorkflowStarted,
}));

vi.mock('../utils', () => ({
  isHourlyMemoryExtractionCancelled: mocks.isHourlyMemoryExtractionCancellationRequested,
}));

const { personaUpdateHandler } = await import('../personaUpdate');

describe('personaUpdateHandler run guard', () => {
  beforeEach(() => {
    mocks.checkGuard.mockReset();
    mocks.composeWriting.mockReset();
    mocks.ensureWorkflowStarted.mockReset();
    mocks.getServerDB.mockReset();
    mocks.isHourlyMemoryExtractionCancellationRequested.mockReset();
    mocks.ensureWorkflowStarted.mockResolvedValue({ started: true });
    mocks.getServerDB.mockResolvedValue({});
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(false);
  });

  it('starts the workflow before checking the run guard or parsing payload', async () => {
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
    expect(mocks.ensureWorkflowStarted).toHaveBeenCalledWith(
      context,
      'api/workflows/memory-user-memory/pipelines/persona/update-writing',
    );
    expect(mocks.checkGuard).toHaveBeenCalledWith(
      context,
      'api/workflows/memory-user-memory/pipelines/persona/update-writing',
      { response: { processedUsers: 0 } },
    );
  });

  it('skips persona writing when the hourly task is cancelled', async () => {
    /**
     * @example
     * await expect(personaUpdateHandler(context)).resolves.toMatchObject({ processedUsers: 0 });
     */
    mocks.checkGuard.mockResolvedValue({ result: true });
    mocks.isHourlyMemoryExtractionCancellationRequested.mockResolvedValue(true);

    const context = {
      requestPayload: {
        hourlyTaskId: '00000000-0000-4000-8000-000000000001',
        userIds: ['user-1'],
      },
      run: vi.fn((_name: string, callback: () => unknown) => callback()),
      workflowRunId: 'wfr_persona',
    };

    await expect(personaUpdateHandler(context as never)).resolves.toEqual({
      message: 'User persona processed via workflow.',
      processedUsers: 0,
    });

    expect(mocks.isHourlyMemoryExtractionCancellationRequested).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(mocks.buildUserPersonaJobInput).not.toHaveBeenCalled();
    expect(mocks.composeWriting).not.toHaveBeenCalled();
  });
});
