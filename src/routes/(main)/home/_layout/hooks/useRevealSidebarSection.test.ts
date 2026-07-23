import { describe, expect, it } from 'vitest';

import { buildRevealSidebarSectionPatch } from './useRevealSidebarSection';

describe('buildRevealSidebarSectionPatch (LOBE-11758)', () => {
  it('expands a collapsed section', () => {
    // Stale persisted keys from before the Private section shipped.
    expect(buildRevealSidebarSectionPatch('private', ['recents', 'agent'], [])).toEqual({
      sidebarExpandedKeys: ['recents', 'agent', 'private'],
    });
  });

  it('un-hides a hidden section', () => {
    expect(
      buildRevealSidebarSectionPatch('private', ['recents', 'agent', 'private'], ['private']),
    ).toEqual({
      hiddenSidebarSections: [],
    });
  });

  it('expands and un-hides in one patch', () => {
    expect(buildRevealSidebarSectionPatch('private', ['agent'], ['recents', 'private'])).toEqual({
      hiddenSidebarSections: ['recents'],
      sidebarExpandedKeys: ['agent', 'private'],
    });
  });

  it('returns null when the section is already visible', () => {
    expect(
      buildRevealSidebarSectionPatch('private', ['recents', 'agent', 'private'], ['recents']),
    ).toBeNull();
  });

  it('handles the workspace (agent) section for the publish direction', () => {
    expect(buildRevealSidebarSectionPatch('agent', ['recents', 'private'], [])).toEqual({
      sidebarExpandedKeys: ['recents', 'private', 'agent'],
    });
  });
});
