import { afterEach, describe, expect, it, vi } from 'vitest';

import * as activeWorkspaceSlugModule from '@/business/client/hooks/useActiveWorkspaceSlug';
import * as stableNavigateModule from '@/utils/stableNavigate';

import { stableWorkspaceAwareNavigate } from '../stableWorkspaceAwareNavigate';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stableWorkspaceAwareNavigate', () => {
  it('prefixes the path with the active workspace slug', () => {
    const navigate = vi.fn();
    vi.spyOn(stableNavigateModule, 'getStableNavigate').mockReturnValue(navigate);
    vi.spyOn(activeWorkspaceSlugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');

    stableWorkspaceAwareNavigate('/group/group-1');

    expect(navigate).toHaveBeenCalledWith('/acme/group/group-1');
  });

  it('leaves the path unchanged in personal mode (no active workspace)', () => {
    const navigate = vi.fn();
    vi.spyOn(stableNavigateModule, 'getStableNavigate').mockReturnValue(navigate);
    // default mock: activeWorkspace() === null

    stableWorkspaceAwareNavigate('/group/group-1');

    expect(navigate).toHaveBeenCalledWith('/group/group-1');
  });

  it('bypasses prefixing when escape is set', () => {
    const navigate = vi.fn();
    vi.spyOn(stableNavigateModule, 'getStableNavigate').mockReturnValue(navigate);
    vi.spyOn(activeWorkspaceSlugModule, 'getActiveWorkspaceSlug').mockReturnValue('acme');

    stableWorkspaceAwareNavigate('/group/group-1', { escape: true });

    expect(navigate).toHaveBeenCalledWith('/group/group-1');
  });

  it('no-ops when the navigate ref is not yet registered', () => {
    vi.spyOn(stableNavigateModule, 'getStableNavigate').mockReturnValue(null);
    const getActiveWorkspaceSlug = vi.spyOn(activeWorkspaceSlugModule, 'getActiveWorkspaceSlug');

    expect(() => stableWorkspaceAwareNavigate('/group/group-1')).not.toThrow();
    expect(getActiveWorkspaceSlug).not.toHaveBeenCalled();
  });
});
