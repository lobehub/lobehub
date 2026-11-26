import { Circle } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { resolveTabVisual } from './resolveTabVisual';

describe('resolveTabVisual', () => {
  it('draws the workspace avatar for a workspace home page instead of its route icon', () => {
    expect(resolveTabVisual({ avatarKind: 'workspace', icon: Circle, title: 'LobeHub' })).toBe(
      'workspace',
    );
  });

  it('draws the agent avatar for an agent page', () => {
    expect(
      resolveTabVisual({ avatarKind: 'agent', avatarSeed: 'agt_1', icon: Circle, title: 'A' }),
    ).toBe('agent');
  });

  it('draws the generated project avatar when a seed is present', () => {
    expect(resolveTabVisual({ avatarSeed: 'proj_1', icon: Circle, title: 'P' })).toBe('project');
  });

  it('draws a plain avatar when only an image or emoji is cached', () => {
    expect(resolveTabVisual({ avatar: '🤖', icon: Circle, title: 'Topic' })).toBe('avatar');
  });

  it('falls back to the route icon, or nothing, when the page has no avatar', () => {
    expect(resolveTabVisual({ icon: Circle, title: 'Tasks' })).toBe('icon');
    expect(resolveTabVisual({ title: 'Blank' })).toBe('none');
  });
});
