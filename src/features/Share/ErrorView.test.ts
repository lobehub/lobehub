import { describe, expect, it } from 'vitest';

import { getShareErrorCopyKeys } from './ErrorView';

describe('getShareErrorCopyKeys', () => {
  it('uses agent-specific copy for agent share authentication and missing-link errors', () => {
    expect(getShareErrorCopyKeys('agent', 'UNAUTHORIZED')).toEqual({
      subtitle: 'sharePage.error.agent.unauthorized.subtitle',
      title: 'sharePage.error.unauthorized.title',
    });
    expect(getShareErrorCopyKeys('agent', 'NOT_FOUND')).toEqual({
      subtitle: 'sharePage.error.agent.notFound.subtitle',
      title: 'sharePage.error.agent.notFound.title',
    });
  });

  it('keeps topic copy as the default share resource', () => {
    expect(getShareErrorCopyKeys('topic', 'NOT_FOUND')).toEqual({
      subtitle: 'sharePage.error.notFound.subtitle',
      title: 'sharePage.error.notFound.title',
    });
  });
});
