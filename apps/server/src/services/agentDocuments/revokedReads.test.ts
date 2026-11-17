import { describe, expect, it, vi } from 'vitest';

import { findRevokedDocumentReads, revokedAgentDocumentRefs } from './revokedReads';

const binding = (
  overrides: Partial<Parameters<typeof revokedAgentDocumentRefs>[1][number]> = {},
) => ({
  accessSelf: 31,
  deletedAt: null,
  documentId: 'docs_rules',
  id: '3f2c4b1a-0000-4000-8000-000000000001',
  ...overrides,
});

describe('revokedAgentDocumentRefs', () => {
  it('revokes a document whose only binding is deleted, by either id', () => {
    const deleted = binding({ deletedAt: new Date() });

    expect(revokedAgentDocumentRefs(['docs_rules', deleted.id], [deleted])).toEqual([
      'docs_rules',
      deleted.id,
    ]);
  });

  it('revokes a document whose binding lost read access (disabled)', () => {
    expect(revokedAgentDocumentRefs(['docs_rules'], [binding({ accessSelf: 0 })])).toEqual([
      'docs_rules',
    ]);
  });

  it('keeps a document that still has a live readable binding', () => {
    const bindings = [
      binding({ deletedAt: new Date(), id: '3f2c4b1a-0000-4000-8000-000000000002' }),
      binding(),
    ];

    expect(revokedAgentDocumentRefs(['docs_rules'], bindings)).toEqual([]);
    // A live binding with policyLoad=disabled (skill index) is still readable.
    expect(revokedAgentDocumentRefs(['docs_rules'], [binding({ accessSelf: 10 })])).toEqual([]);
  });

  it('revokes a binding id whose binding was permanently deleted', () => {
    expect(revokedAgentDocumentRefs(['3f2c4b1a-0000-4000-8000-00000000dead'], [])).toEqual([
      '3f2c4b1a-0000-4000-8000-00000000dead',
    ]);
  });

  it('never revokes ids the agent has no binding for', () => {
    expect(
      revokedAgentDocumentRefs(
        ['docs_kb_page', 'file_upload'],
        [binding({ deletedAt: new Date() })],
      ),
    ).toEqual([]);
  });
});

describe('findRevokedDocumentReads', () => {
  const model = (overrides: Record<string, unknown> = {}) => ({
    listBindingStatesByRefs: vi.fn(async () => [] as any[]),
    listExistingDocumentIds: vi.fn(async (ids: string[]) => ids),
    listKnowledgeBaseMemberIds: vi.fn(async () => [] as string[]),
    ...overrides,
  });

  it('revokes a docs_* id whose document was permanently deleted', async () => {
    const m = model({
      listExistingDocumentIds: vi.fn(async () => ['docs_live']),
    });

    expect(
      await findRevokedDocumentReads(m, 'agt_1', ['docs_gone', 'docs_live', 'file_x']),
    ).toEqual({ agentDocumentReadIds: [], documentIds: ['docs_gone'] });
    expect(m.listExistingDocumentIds).toHaveBeenCalledWith(['docs_gone', 'docs_live']);
  });

  it('revokes a removed knowledge-base page only for the agent-document read route', async () => {
    const m = model({
      listBindingStatesByRefs: vi.fn(async () => [
        { accessSelf: 31, deletedAt: new Date(), documentId: 'docs_kb', id: 'b-1' },
        { accessSelf: 31, deletedAt: new Date(), documentId: 'docs_rule', id: 'b-2' },
      ]),
      listKnowledgeBaseMemberIds: vi.fn(async () => ['docs_kb']),
    });

    // readKnowledge can still return the KB page; the agent's readDocument cannot.
    expect(await findRevokedDocumentReads(m, 'agt_1', ['docs_kb', 'docs_rule'])).toEqual({
      agentDocumentReadIds: ['docs_kb'],
      documentIds: ['docs_rule'],
    });
  });

  it('does no lookups without ids', async () => {
    const m = model();

    expect(await findRevokedDocumentReads(m, 'agt_1', [])).toEqual({
      agentDocumentReadIds: [],
      documentIds: [],
    });
    expect(m.listBindingStatesByRefs).not.toHaveBeenCalled();
  });
});
