// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findById = vi.fn();
const startRefine = vi.fn();
const guard = vi.fn();

vi.mock('@/database/models/meeting', () => ({
  MeetingModel: vi.fn(function () {
    return { findById, startRefine };
  }),
}));

vi.mock('@/server/services/knowledgeBaseAccess', () => ({
  assertFileNotInRestrictedKnowledgeBase: guard,
}));

vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({ UserModel: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('../systemAgent/modelConfig', () => ({ resolveSystemAgentModelConfig: vi.fn() }));
vi.mock('../minutes', () => ({ MeetingMinutesService: vi.fn() }));
vi.mock('../transcribeRecording', () => ({ transcribeRecording: vi.fn() }));

const { MeetingTranscriptionService } = await import('../index');

const service = () => new MeetingTranscriptionService({} as any, 'user-1', 'workspace-1');

beforeEach(() => {
  vi.clearAllMocks();
  startRefine.mockResolvedValue({ id: 'meeting-1', status: 'transcribing' });
});

describe('MeetingTranscriptionService.refine · recording access', () => {
  it('rechecks restricted knowledge-base access before reading the recording', async () => {
    findById.mockResolvedValue({ audioFileId: 'file-1', id: 'meeting-1', userId: 'user-1' });
    guard.mockRejectedValue(new Error('FORBIDDEN'));

    await expect(service().refine('meeting-1')).rejects.toThrow('FORBIDDEN');
    expect(guard).toHaveBeenCalledWith(
      { serverDB: {}, userId: 'user-1', workspaceId: 'workspace-1' },
      'file-1',
    );
    // The meeting keeps the state the caller can still act on.
    expect(startRefine).not.toHaveBeenCalled();
  });

  it('does not run the pass for a meeting the caller cannot manage', async () => {
    findById.mockResolvedValue({ audioFileId: 'file-1', id: 'meeting-1', userId: 'someone-else' });

    await expect(service().refine('meeting-1')).resolves.toBeUndefined();
    expect(guard).not.toHaveBeenCalled();
    expect(startRefine).not.toHaveBeenCalled();
  });

  it('checks nothing for a meeting without a stored recording', async () => {
    findById.mockResolvedValue({ audioFileId: null, id: 'meeting-1', userId: 'user-1' });
    startRefine.mockResolvedValue(undefined);

    await expect(service().refine('meeting-1')).resolves.toBeUndefined();
    expect(guard).not.toHaveBeenCalled();
  });
});
