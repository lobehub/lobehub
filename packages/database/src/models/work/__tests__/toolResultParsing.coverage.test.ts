import { describe, expect, it } from 'vitest';

import { normalizeLinearToolResult } from '../linearToolResult';
import { sanitizeExternalUrl } from '../toolResultParsing';

describe('sanitizeExternalUrl', () => {
  it('skips a whitespace-only url', () => {
    expect(sanitizeExternalUrl('   ')).toBeUndefined();
  });
});

describe('normalizeLinearToolResult · field fallbacks', () => {
  it('falls through a non-string description to content and keeps a null state', () => {
    const operation = normalizeLinearToolResult({
      data: {
        content: 'Issue body',
        description: 42,
        id: 'issue-uuid-1',
        identifier: 'LOB-1',
        state: null,
        title: 'Numeric description',
      },
      toolName: 'save_issue',
    });

    expect(operation?.params).toMatchObject({
      content: 'Issue body',
      description: 'Issue body',
      identifier: 'LOB-1',
      resourceId: 'issue-uuid-1',
      resourceType: 'linear_issue',
      status: null,
    });
    expect(operation?.params.patchFields).toEqual(
      expect.arrayContaining(['content', 'description', 'status', 'title']),
    );
  });

  it('clears the status when a nested state object carries no name or type', () => {
    const operation = normalizeLinearToolResult({
      data: { id: 'issue-uuid-2', identifier: 'LOB-2', state: {} },
      toolName: 'save_issue',
    });

    expect(operation?.params.status).toBeNull();
    expect(operation?.params.patchFields).toContain('status');
  });

  it('leaves the identifier unset when a document url has no document segment', () => {
    const operation = normalizeLinearToolResult({
      data: { id: 'doc-uuid-1', title: 'Spec', url: 'https://linear.app/lobehub/view/all' },
      toolName: 'update_document',
    });

    expect(operation?.params).toMatchObject({
      changeType: 'updated',
      identifier: null,
      resourceId: 'doc-uuid-1',
      resourceType: 'linear_document',
      url: 'https://linear.app/lobehub/view/all',
    });
    expect(operation?.params.patchFields).not.toContain('identifier');
  });
});
