// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { removeRouter } from './remove';

const mocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  deleteMany: vi.fn(),
  findById: vi.fn(),
  findByIds: vi.fn(),
  removeOne: vi.fn(),
  scrub: vi.fn(),
}));

vi.mock('@/server/services/contextReplay/scrub', () => ({
  scrubDeletedContextSources: mocks.scrub,
}));
vi.mock('../_helpers/knowledgeBaseAccess', () => ({
  assertFileNotInRestrictedKnowledgeBase: vi.fn(),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: class {
    delete = mocks.removeOne;
    deleteMany = mocks.deleteMany;
    findById = mocks.findById;
    findByIds = mocks.findByIds;
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    deleteFile = mocks.deleteFile;
    deleteFiles = vi.fn();
  },
}));

const caller = () =>
  removeRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findById.mockResolvedValue({ id: 'file-1' });
  mocks.removeOne.mockResolvedValue({ url: 'files/file-1' });
  mocks.findByIds.mockResolvedValue([{ id: 'file-1' }, { id: 'file-2' }]);
  mocks.deleteMany.mockResolvedValue([]);
});

it('clears a removed file from stored model input', async () => {
  await caller().removeFile({ id: 'file-1' });
  expect(mocks.scrub).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
    ids: ['file:file-1'],
  });
});

it('clears every removed file from stored model input', async () => {
  await caller().removeFiles({ ids: ['file-1', 'file-2'] });
  expect(mocks.scrub).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
    ids: ['file:file-1', 'file:file-2'],
  });
});
