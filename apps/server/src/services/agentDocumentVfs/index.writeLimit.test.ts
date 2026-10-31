// @vitest-environment node
import { AGENT_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkDocumentCharLimit } from '@/business/server/document/writeLimit';
import { AgentAccess } from '@/database/models/agentDocuments';

import { AgentDocumentVfsService } from './index';
import { db, mockAgentDocumentModel, resetVfsMocks, userId } from './testUtils';

vi.mock('@/business/server/document/writeLimit', () => ({
  checkDocumentCharLimit: vi.fn(),
}));

vi.mock('@/database/models/agentDocuments', () => ({
  AgentAccess: { DELETE: 16, EXECUTE: 1, LIST: 8, READ: 2, WRITE: 4 },
  AgentDocumentModel: vi.fn(),
  buildDocumentFilename: vi.fn(function (title: string) {
    return title;
  }),
}));

vi.mock('./mounts/skills/createSkillMount', () => ({
  createSkillMount: vi.fn(),
}));

vi.mock('../file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

const check = vi.mocked(checkDocumentCharLimit);

const ctx = { agentId: 'agent-1' };

const existingDoc = (content: string) => ({
  accessSelf: AgentAccess.READ | AgentAccess.WRITE | AgentAccess.LIST,
  content,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  documentId: 'documents-1',
  fileType: AGENT_DOCUMENT_FILE_TYPE,
  filename: 'notes.md',
  id: 'agent-doc-1',
  metadata: null,
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
});

describe('AgentDocumentVfsService per-document character limit', () => {
  beforeEach(() => {
    resetVfsMocks();
    check.mockReset();
    check.mockResolvedValue({ allowed: false, limit: 10, plan: 'free' });
    mockAgentDocumentModel.create.mockResolvedValue(existingDoc('x'));
    mockAgentDocumentModel.update.mockResolvedValue(undefined);
  });

  it('refuses a new file over the limit before creating it', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(undefined);

    const service = new AgentDocumentVfsService(db, userId);

    await expect(service.write('./notes.md', 'x'.repeat(50), ctx)).rejects.toMatchObject({
      cause: { data: { code: 'DocumentCharLimitExceeded', limit: 10 } },
    });
    expect(mockAgentDocumentModel.create).not.toHaveBeenCalled();
  });

  it('refuses a raw rewrite that grows past the limit and keeps the stored body', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(existingDoc('short'));

    const service = new AgentDocumentVfsService(db, userId);

    await expect(
      service.write('./notes.md', 'x'.repeat(50), ctx, { contentFormat: 'raw' }),
    ).rejects.toMatchObject({ cause: { data: { code: 'DocumentCharLimitExceeded' } } });
    expect(mockAgentDocumentModel.update).not.toHaveBeenCalled();
  });

  it('leaves a live room to check the limit against its own body', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(existingDoc('short'));
    const writeThroughRoom = vi.fn().mockResolvedValue(true);
    const service = new AgentDocumentVfsService(db, userId);
    (service as any).deps.writeThroughRoom = writeThroughRoom;

    await service.write('./notes.md', 'x'.repeat(50), ctx);

    expect(writeThroughRoom).toHaveBeenCalledWith('documents-1', expect.anything(), 'user');
    expect(mockAgentDocumentModel.update).not.toHaveBeenCalled();
  });

  it('refuses a markdown rewrite of a page without a live room before the row write', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(existingDoc('short'));
    const writeThroughRoom = vi.fn().mockResolvedValue(false);
    const service = new AgentDocumentVfsService(db, userId);
    (service as any).deps.writeThroughRoom = writeThroughRoom;

    await expect(service.write('./notes.md', 'x'.repeat(50), ctx)).rejects.toMatchObject({
      cause: { data: { code: 'DocumentCharLimitExceeded' } },
    });
    expect(mockAgentDocumentModel.update).not.toHaveBeenCalled();
  });

  it('allows a rewrite that does not make an over-limit document longer', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(existingDoc('x'.repeat(100)));

    const service = new AgentDocumentVfsService(db, userId);
    await service.write('./notes.md', 'x'.repeat(40), ctx, { contentFormat: 'raw' });

    expect(mockAgentDocumentModel.update).toHaveBeenCalled();
  });

  it('skips the limit for a system write', async () => {
    mockAgentDocumentModel.findByParentAndFilename.mockResolvedValue(undefined);

    const service = new AgentDocumentVfsService(db, userId);
    await service.write('./notes.md', 'x'.repeat(50), ctx, {
      contentFormat: 'raw',
      source: 'system',
    });

    expect(check).not.toHaveBeenCalled();
    expect(mockAgentDocumentModel.create).toHaveBeenCalled();
  });

  it('copies a file as a system write', async () => {
    const service = new AgentDocumentVfsService(db, userId);
    vi.spyOn(service, 'stat')
      .mockResolvedValueOnce({ type: 'file' } as any)
      .mockResolvedValueOnce(undefined);
    vi.spyOn(service, 'read').mockResolvedValue({ content: 'x'.repeat(50) } as any);
    const write = vi.spyOn(service, 'write').mockResolvedValue({} as any);

    await service.copy('./a.md', './b.md', ctx);

    expect(write).toHaveBeenCalledWith('./b.md', 'x'.repeat(50), ctx, {
      createMode: 'always-new',
      source: 'system',
    });
  });
});
