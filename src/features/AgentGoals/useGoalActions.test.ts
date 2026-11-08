import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalShareUrl } from './useGoalActions';

const mocks = vi.hoisted(() => ({
  origin: 'https://app.lobehub.com' as string | undefined,
  slug: null as string | null,
}));

vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => mocks.origin }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.slug,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/store/goal', () => ({ useGoalStore: vi.fn() }));

describe('useGoalShareUrl', () => {
  beforeEach(() => {
    mocks.origin = 'https://app.lobehub.com';
    mocks.slug = null;
  });

  it('links an agent goal under its agent and a project goal at the top level', () => {
    expect(
      renderHook(() => useGoalShareUrl({ agentId: 'agt_1', goalId: 'goal_1' })).result.current,
    ).toBe('https://app.lobehub.com/agent/agt_1/goal/goal_1');
    expect(renderHook(() => useGoalShareUrl({ goalId: 'goal_1' })).result.current).toBe(
      'https://app.lobehub.com/goal/goal_1',
    );
  });

  // Regression: the link used to be hand-built without the workspace prefix,
  // so a copied workspace goal link opened in the personal scope.
  it('carries the active workspace prefix', () => {
    mocks.slug = 'acme';

    expect(
      renderHook(() => useGoalShareUrl({ agentId: 'agt_1', goalId: 'goal_1' })).result.current,
    ).toBe('https://app.lobehub.com/acme/agent/agt_1/goal/goal_1');
    expect(renderHook(() => useGoalShareUrl({ goalId: 'goal_1' })).result.current).toBe(
      'https://app.lobehub.com/acme/goal/goal_1',
    );
  });

  it('has no link without an app origin', () => {
    mocks.origin = undefined;

    expect(renderHook(() => useGoalShareUrl({ goalId: 'goal_1' })).result.current).toBeUndefined();
  });
});
