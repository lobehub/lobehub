// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertFileNotInRestrictedKnowledgeBase } from './_helpers/knowledgeBaseAccess';
import { meetingRouter } from './meeting';

const mocks = vi.hoisted(() => ({
  fileModel: { findById: vi.fn(), findMeetingAudio: vi.fn() },
  fileService: { getFullFileUrl: vi.fn(), removeUnreferencedFile: vi.fn() },
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

const audioFile = { fileType: 'audio/webm', id: 'file-audio', name: 'a.webm', size: 42, url: 'k/a' };
const forbidden = () =>
  new TRPCError({ code: 'FORBIDDEN', message: 'Only knowledge base managers can view this file' });

const caller = () =>
  meetingRouter.createCaller({ userId: 'u1', workspaceId: 'ws', workspaceRole: 'member' } as never);

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue(undefined);
  mocks.fileModel.findById.mockResolvedValue(audioFile);
  mocks.fileModel.findMeetingAudio.mockResolvedValue(undefined);
  mocks.meetingModel.findById.mockResolvedValue({ id: 'meeting-1' });
  mocks.meetingModel.attachAudio.mockResolvedValue({ audioFileId: audioFile.id });
  mocks.meetingModel.getDetail.mockResolvedValue({
    audioFileId: audioFile.id,
    id: 'meeting-1',
    userId: 'u1',
  });
  mocks.fileService.getFullFileUrl.mockResolvedValue('https://cdn/k/a');
  mocks.fileService.removeUnreferencedFile.mockResolvedValue(undefined);
});

describe('meetingRouter.attachAudio knowledge-base gate', () => {
  it('refuses to attach a file parked in a restricted knowledge base', async () => {
    guard.mockRejectedValue(forbidden());

    await expect(caller().attachAudio({ audioFileId: audioFile.id, id: 'meeting-1' })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );

    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', workspaceId: 'ws' }), audioFile.id);
    // Nothing is written, so the meeting never points at the blocked upload.
    expect(mocks.meetingModel.attachAudio).not.toHaveBeenCalled();
  });

  it('attaches the audio once the file passes the gate', async () => {
    await expect(
      caller().attachAudio({ audioFileId: audioFile.id, id: 'meeting-1' }),
    ).resolves.toMatchObject({ success: true });

    expect(mocks.meetingModel.attachAudio).toHaveBeenCalledWith('meeting-1', {
      audioFileId: audioFile.id,
    });
  });

  it('skips the gate for device-local paths that never reach storage', async () => {
    await caller().attachAudio({ id: 'meeting-1', localAudioPath: '/Users/me/a.m4a' });

    expect(guard).not.toHaveBeenCalled();
  });
});

describe('meetingRouter.detail playback gate', () => {
  it('withholds the signed audio URL when the file moved into a restricted knowledge base', async () => {
    guard.mockRejectedValue(forbidden());

    await expect(caller().detail({ id: 'meeting-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mocks.fileService.getFullFileUrl).not.toHaveBeenCalled();
  });

  it('returns the audio only after the gate passes', async () => {
    await expect(caller().detail({ id: 'meeting-1' })).resolves.toMatchObject({
      data: { audio: { id: audioFile.id, url: 'https://cdn/k/a' }, id: 'meeting-1' },
    });

    expect(guard).toHaveBeenCalledWith(expect.anything(), audioFile.id);
  });

  it('does not consult the gate for a meeting without audio', async () => {
    mocks.meetingModel.getDetail.mockResolvedValue({ id: 'meeting-1', userId: 'u1' });

    await expect(caller().detail({ id: 'meeting-1' })).resolves.toMatchObject({
      data: { audio: null },
    });

    expect(guard).not.toHaveBeenCalled();
  });
});
