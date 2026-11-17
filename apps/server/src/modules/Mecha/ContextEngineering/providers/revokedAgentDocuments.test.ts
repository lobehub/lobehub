import { describe, expect, it } from 'vitest';

import { revokedAgentDocumentRefs } from './revokedAgentDocuments';

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
