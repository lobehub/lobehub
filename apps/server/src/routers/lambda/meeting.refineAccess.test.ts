// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertFileNotInRestrictedKnowledgeBase } from './_helpers/knowledgeBaseAccess';
import { meetingRouter } from './meeting';

const mocks = vi.hoisted(() => ({
  fileModel: { findById: vi.fn(), findMeetingAudio: vi.fn() },
  fileService: { getFullFileUrl: vi.fn(), removeUnreferencedFile: vi.fn() },
  meetingJobs: { startRefine: vi.fn(), startMinutes: vi.fn() },
  meetingModel: { attachAudio: vi.fn(), findById: vi.fn(), getDetail: vi.fn() },
}));

vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return mocks.fileModel;
  }),
}));
vi.mock('@/database/models/meeting', () => ({
  MeetingModel: vi.fn(function () {
    return mocks.meetingModel;
  }),
  MeetingStateError: class MeetingStateError extends Error {},
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return mocks.fileService;
  }),
}));
vi.mock('@/server/services/meeting/startJob', () => ({
  MeetingJobService: vi.fn(function () {
    return mocks.meetingJobs;
  }),
}));
vi.mock('./_helpers/knowledgeBaseAccess', () => ({
  assertFileNotInRestrictedKnowledgeBase: vi.fn(),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => trpc.middleware((opts) => opts.next()),
    wsCompatProcedure: trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    serverDatabase: trpc.middleware((opts) =>
      opts.next({ ctx: { ...opts.ctx, serverDB: {} as never } }),
    ),
  };
});

const guard = vi.mocked(assertFileNotInRestrictedKnowledgeBase);

const forbidden = () =>
  new TRPCError({ code: 'FORBIDDEN', message: 'Only knowledge base managers can view this file' });

const caller = () =>
  meetingRouter.createCaller({ userId: 'u1', workspaceId: 'ws', workspaceRole: 'member' } as never);

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue(undefined);
  mocks.meetingModel.findById.mockResolvedValue({
    audioFileId: 'file-audio',
    id: 'meeting-1',
    status: 'ready',
    userId: 'u1',
  });
  mocks.meetingJobs.startRefine.mockResolvedValue({
    meeting: { id: 'meeting-1', status: 'transcribing' },
    taskId: 'task-1',
  });
});

describe('meetingRouter.refine knowledge-base gate', () => {
  it('refuses before the job starts, so a ready meeting stays ready', async () => {
    guard.mockRejectedValue(forbidden());

    await expect(caller().refine({ id: 'meeting-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), 'file-audio');
    // The stage transition is what would leave the meeting unusable: it must not happen.
    expect(mocks.meetingJobs.startRefine).not.toHaveBeenCalled();
  });

  it('starts the refine pass once the recording passes the gate', async () => {
    await expect(caller().refine({ id: 'meeting-1' })).resolves.toMatchObject({
      success: true,
      taskId: 'task-1',
    });

    expect(mocks.meetingJobs.startRefine).toHaveBeenCalledWith('meeting-1');
  });

  it('skips the gate for device-local recordings that never reach storage', async () => {
    mocks.meetingModel.findById.mockResolvedValue({
      id: 'meeting-1',
      localAudioPath: '/Users/me/a.m4a',
      status: 'ready',
      userId: 'u1',
    });

    await caller().refine({ id: 'meeting-1' });

    expect(guard).not.toHaveBeenCalled();
  });

  it('reports a meeting of another user as missing', async () => {
    mocks.meetingModel.findById.mockResolvedValue(undefined);

    await expect(caller().refine({ id: 'meeting-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(guard).not.toHaveBeenCalled();
    expect(mocks.meetingJobs.startRefine).not.toHaveBeenCalled();
  });
});
