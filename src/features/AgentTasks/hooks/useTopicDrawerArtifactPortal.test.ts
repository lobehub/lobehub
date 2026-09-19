import { describe, expect, it } from 'vitest';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import { resolveTopicDrawerPortalHostViewType } from './useTopicDrawerArtifactPortal';

describe('resolveTopicDrawerPortalHostViewType', () => {
  it.each([PortalViewType.TaskDetail, PortalViewType.TaskResult])(
    'keeps the %s portal mounted while its drawer owns the artifact',
    (parentViewType) => {
      expect(
        resolveTopicDrawerPortalHostViewType({
          currentViewType: PortalViewType.Artifact,
          parentViewType,
          showArtifactPortal: true,
        }),
      ).toBe(parentViewType);
    },
  );

  it('keeps the artifact in the outer host when no task portal owns it', () => {
    expect(
      resolveTopicDrawerPortalHostViewType({
        currentViewType: PortalViewType.Artifact,
        parentViewType: PortalViewType.TaskDetail,
        showArtifactPortal: false,
      }),
    ).toBe(PortalViewType.Artifact);
  });

  it('does not preserve an unrelated parent portal', () => {
    expect(
      resolveTopicDrawerPortalHostViewType({
        currentViewType: PortalViewType.Artifact,
        parentViewType: PortalViewType.Goal,
        showArtifactPortal: true,
      }),
    ).toBe(PortalViewType.Artifact);
  });
});
