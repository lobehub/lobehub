import { describe, expect, it } from 'vitest';

import { resolveProposalWriteTarget } from './resolveProposalWriteTarget';

const resources = [
  { label: 'Moshi research', resourceId: 'doc-1', resourceType: 'page' as const },
  { label: 'Moshi research', resourceId: 'topic-1', resourceType: 'topic' as const },
];

describe('resolveProposalWriteTarget', () => {
  it('names the linked Page an append draft writes into', () => {
    expect(
      resolveProposalWriteTarget(
        { kind: 'tool_call', payload: { apiName: 'modifyNodes', documentId: 'doc-1' } },
        resources,
      ),
    ).toEqual({ title: 'Moshi research', type: 'append' });
  });

  it('keeps the append target when the Page is no longer linked', () => {
    expect(
      resolveProposalWriteTarget(
        { kind: 'tool_call', payload: { documentId: 'topic-1' } },
        resources,
      ),
    ).toEqual({ title: undefined, type: 'append' });
  });

  it('names the new Page a create draft writes', () => {
    expect(
      resolveProposalWriteTarget(
        { kind: 'tool_call', payload: { apiName: 'initPage', title: '  Duplex notes \n more' } },
        resources,
      ),
    ).toEqual({ title: 'Duplex notes', type: 'create' });
    expect(resolveProposalWriteTarget({ kind: 'tool_call', payload: {} }, [])).toEqual({
      title: undefined,
      type: 'create',
    });
  });

  it('bounds a label that fell back to document content', () => {
    const label = 'x'.repeat(80);
    expect(
      resolveProposalWriteTarget({ kind: 'tool_call', payload: { documentId: 'doc-2' } }, [
        { label, resourceId: 'doc-2', resourceType: 'document' },
      ])?.title,
    ).toBe(`${'x'.repeat(60)}…`);
  });

  it('ignores other Proposal kinds', () => {
    expect(resolveProposalWriteTarget({ kind: 'task', payload: {} }, resources)).toBeUndefined();
  });
});
