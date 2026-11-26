// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { documentsRouter } from './documents';

const mocks = vi.hoisted(() => ({
  deleteDocument: vi.fn(),
  getDocument: vi.fn(),
  scrub: vi.fn(),
}));

vi.mock('@/server/services/contextReplay/scrub', () => ({
  scrubDeletedContextSources: mocks.scrub,
}));
vi.mock('@/server/services/agentDocumentVfs', () => ({ AgentDocumentVfsService: class {} }));
vi.mock('@/server/services/skillManagement', () => ({
  SkillManagementDocumentService: class {},
}));
vi.mock('@/server/services/systemAgent', () => ({ SystemAgentService: class {} }));
vi.mock('@/server/services/agentDocuments/documentWork', () => ({
  createDocumentWorkRegistrar: () => ({}),
}));
vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: class {
    deleteDocument = mocks.deleteDocument;
    getDocument = mocks.getDocument;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDocument.mockResolvedValue({ id: 'agent-doc-1' });
});

it('clears a deleted agent document from stored model input', async () => {
  await documentsRouter
    .createCaller({ serverDB: {}, userId: 'user-1' } as never)
    .deleteDocument({ agentId: 'agent-1', filename: 'rules.md' });
  expect(mocks.scrub).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
    ids: ['document:agent-doc-1', 'document-read:agent-doc-1'],
  });
});
