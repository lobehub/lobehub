// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceEvidenceRuntime } from './acceptanceEvidence';

const mocks = vi.hoisted(() => ({
  documentFindByIds: vi.fn(),
  evidenceCreateMany: vi.fn(),
  fileFindById: vi.fn(),
  operationFindById: vi.fn(),
  resultUpsert: vi.fn(),
  runFindByOperation: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(() => ({ findById: mocks.operationFindById })),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({ findByIds: mocks.documentFindByIds })),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({ findById: mocks.fileFindById })),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({ upsertByCheckItem: mocks.resultUpsert })),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(() => ({ createMany: mocks.evidenceCreateMany })),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({ findByOperation: mocks.runFindByOperation })),
}));

describe('acceptanceEvidenceRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operationFindById.mockResolvedValue({ parentOperationId: 'parent-op' });
    mocks.runFindByOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        { id: 'criterion-1', index: 0, required: true, title: 'Document', verifierType: 'llm' },
      ],
    });
    mocks.resultUpsert.mockResolvedValue({ id: 'result-1' });
    mocks.evidenceCreateMany.mockResolvedValue([]);
  });

  it('records a documents.id reference as first-class evidence', async () => {
    mocks.documentFindByIds.mockResolvedValue([{ id: 'docs_123' }]);
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'evidence-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ documentId: 'docs_123', type: 'markdown' }],
    });

    expect(result.success).toBe(true);
    expect(mocks.evidenceCreateMany).toHaveBeenCalledWith([
      expect.objectContaining({ documentId: 'docs_123', fileId: null }),
    ]);
  });

  it('rejects an agent-document binding id instead of inserting it as a file', async () => {
    mocks.documentFindByIds.mockResolvedValue([]);
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'evidence-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ documentId: 'agent-document-binding-uuid', type: 'markdown' }],
    });

    expect(result).toEqual(expect.objectContaining({ error: 'UNKNOWN_DOCUMENT', success: false }));
    expect(mocks.resultUpsert).not.toHaveBeenCalled();
    expect(mocks.evidenceCreateMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown files.id before the evidence foreign key is evaluated', async () => {
    mocks.fileFindById.mockResolvedValue(undefined);
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'evidence-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ fileId: 'agent-document-binding-uuid', type: 'markdown' }],
    });

    expect(result).toEqual(expect.objectContaining({ error: 'UNKNOWN_FILE', success: false }));
    expect(mocks.evidenceCreateMany).not.toHaveBeenCalled();
  });
});
