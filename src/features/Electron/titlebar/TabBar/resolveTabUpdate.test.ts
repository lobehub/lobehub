import { describe, expect, it } from 'vitest';

import { resolveTabUpdate } from './resolveTabUpdate';
import { PERSONAL_TAB_SCOPE, type TabScope } from './scope';

const workspace = (slug: string): TabScope => ({ slug, type: 'workspace' });

describe('resolveTabUpdate', () => {
  it('rewrites when the reported url stays in the active personal scope', () => {
    expect(resolveTabUpdate(PERSONAL_TAB_SCOPE, '/agent/abc')).toEqual({ type: 'rewrite' });
  });

  it('rewrites when the reported url stays in the same workspace scope', () => {
    expect(resolveTabUpdate(workspace('acme'), '/acme/agent/abc')).toEqual({ type: 'rewrite' });
  });

  it('scope-swaps when a personal tab reports a workspace url', () => {
    expect(resolveTabUpdate(PERSONAL_TAB_SCOPE, '/acme/agent/abc')).toEqual({
      scope: workspace('acme'),
      type: 'scope-swap',
      url: '/acme/agent/abc',
    });
  });

  it('scope-swaps when a workspace tab reports a personal url', () => {
    expect(resolveTabUpdate(workspace('acme'), '/settings')).toEqual({
      scope: PERSONAL_TAB_SCOPE,
      type: 'scope-swap',
      url: '/settings',
    });
  });

  it('scope-swaps between two different workspaces', () => {
    expect(resolveTabUpdate(workspace('acme'), '/globex/agent/abc')).toEqual({
      scope: workspace('globex'),
      type: 'scope-swap',
      url: '/globex/agent/abc',
    });
  });
});
