// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const mocks = vi.hoisted(() => ({
  createAgentWork: vi.fn(),
  deleteAgentWork: vi.fn(),
  resolveFile: vi.fn(),
  resolveRun: vi.fn(),
  updateAgentWork: vi.fn(),
}));

vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAgentWorkFile: mocks.resolveFile,
  resolveAgentWorkRun: mocks.resolveRun,
}));

const { AgentWorkError } = await import('@/database/models/work');
const { AgentWorkRunError } = await import('@/server/services/workRegistration');
const { workRouter } = await import('../work');

const run = { operationId: 'op_run', topicId: 'tpc_1', userId: 'user-1' };

const createCaller = () =>
  workRouter.createCaller({
    oidcAuth: { purpose: 'oidc', sub: 'user-1' },
    serverDB: {},
    userId: 'user-1',
  } as any);

const expectCode = async (promise: Promise<unknown>, code: TRPCError['code']) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(TRPCError);
  expect((error as TRPCError).code).toBe(code);
};

describe('workRouter — agent-created Works', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRun.mockResolvedValue({
      run,
      workModel: {
        createAgentWork: mocks.createAgentWork,
        deleteAgentWork: mocks.deleteAgentWork,
        updateAgentWork: mocks.updateAgentWork,
      },
      workspaceId: 'ws_1',
    });
    mocks.resolveFile.mockResolvedValue({
      fileId: 'file_1',
      fileSize: 10,
      fileUrl: 'https://app.example.com/f/file_1',
      mimeType: 'application/pdf',
    });
    mocks.createAgentWork.mockResolvedValue({ id: 'work_1' });
    mocks.updateAgentWork.mockResolvedValue({ id: 'work_1' });
  });

  it('registers a file from the uploaded file row, not from caller-supplied metadata', async () => {
    await createCaller().createAgentWork({
      fileId: 'file_1',
      filePath: '/workspace/report.pdf',
      operationId: 'op_run',
      type: 'file',
    });

    expect(mocks.resolveRun).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op_run', userId: 'user-1' }),
    );
    expect(mocks.resolveFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file_1', userId: 'user-1', workspaceId: 'ws_1' }),
    );
    expect(mocks.createAgentWork).toHaveBeenCalledWith(run, {
      description: undefined,
      file: {
        fileId: 'file_1',
        filePath: '/workspace/report.pdf',
        fileSize: 10,
        fileUrl: 'https://app.example.com/f/file_1',
        mimeType: 'application/pdf',
      },
      title: undefined,
      type: 'file',
    });
  });

  it('requires a title for a link', async () => {
    await expectCode(
      createCaller().createAgentWork({
        operationId: 'op_run',
        type: 'link',
        url: 'https://preview.example.com',
      } as any),
      'BAD_REQUEST',
    );
    expect(mocks.resolveRun).not.toHaveBeenCalled();
  });

  it('maps run and Work refusals onto tRPC error codes', async () => {
    mocks.resolveRun.mockRejectedValueOnce(
      new AgentWorkRunError('Operation has already ended', 409),
    );
    await expectCode(
      createCaller().updateAgentWork({ operationId: 'op_run', title: 'x', workId: 'work_1' }),
      'CONFLICT',
    );

    mocks.updateAgentWork.mockRejectedValueOnce(new AgentWorkError('FORBIDDEN', 'automatic'));
    await expectCode(
      createCaller().updateAgentWork({ operationId: 'op_run', title: 'x', workId: 'work_1' }),
      'FORBIDDEN',
    );
  });

  it('uploads nothing extra when an update names no file', async () => {
    await createCaller().updateAgentWork({
      description: 'Second draft',
      operationId: 'op_run',
      workId: 'work_1',
    });

    expect(mocks.resolveFile).not.toHaveBeenCalled();
    expect(mocks.updateAgentWork).toHaveBeenCalledWith(run, {
      description: 'Second draft',
      file: undefined,
      title: undefined,
      workId: 'work_1',
    });
  });

  it('deletes a Work through the run resolved from the operation', async () => {
    mocks.deleteAgentWork.mockResolvedValueOnce({ id: 'work_1', title: 'Wrong' });

    await expect(
      createCaller().deleteAgentWork({ operationId: 'op_run', workId: 'work_1' }),
    ).resolves.toEqual({ id: 'work_1', title: 'Wrong' });
    expect(mocks.resolveRun).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op_run' }),
    );
    expect(mocks.deleteAgentWork).toHaveBeenCalledWith(run, 'work_1');

    mocks.deleteAgentWork.mockRejectedValueOnce(new AgentWorkError('NOT_FOUND', 'missing'));
    await expectCode(
      createCaller().deleteAgentWork({ operationId: 'op_run', workId: 'work_2' }),
      'NOT_FOUND',
    );
  });
});
