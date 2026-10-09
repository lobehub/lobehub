import { describe, expect, it } from 'vitest';

import TopicsSkeleton from '@/components/Skeleton/Topics';
import { routeMeta } from '@/spa/router/routeMeta';

import { resolveRouteSkeleton } from './useRouteSkeleton';

describe('resolveRouteSkeleton', () => {
  it('returns the deepest match that declares a skeleton', () => {
    const Skeleton = resolveRouteSkeleton([
      { handle: { meta: routeMeta({ titleKey: 'navigation.chat' }) } },
      { handle: { meta: routeMeta({ Skeleton: TopicsSkeleton, titleKey: 'navigation.topics' }) } },
    ]);

    expect(Skeleton).toBe(TopicsSkeleton);
  });

  it('skips matches without a skeleton and uses the nearest ancestor', () => {
    const Skeleton = resolveRouteSkeleton([
      { handle: { meta: routeMeta({ Skeleton: TopicsSkeleton, titleKey: 'navigation.topics' }) } },
      { handle: { meta: routeMeta({ titleKey: 'navigation.permission' }) } },
    ]);

    expect(Skeleton).toBe(TopicsSkeleton);
  });

  it('returns undefined when no match declares a skeleton', () => {
    expect(
      resolveRouteSkeleton([{ handle: { meta: routeMeta({ titleKey: 'navigation.chat' }) } }]),
    ).toBeUndefined();
  });
});
