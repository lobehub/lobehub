import { describe, expect, it } from 'vitest';

import { buildRevealSidebarSectionPatch } from './useRevealSidebarSection';

describe('buildRevealSidebarSectionPatch ', () => {
  it('expands a collapsed section', () => {
    expect(buildRevealSidebarSectionPatch('agent', ['recents'], [])).toEqual({
      sidebarExpandedKeys: ['recents', 'agent'],
    });
  });

  it('un-hides a hidden section', () => {
    expect(buildRevealSidebarSectionPatch('agent', ['recents', 'agent'], ['agent'])).toEqual({
      hiddenSidebarSections: [],
    });
  });

  it('expands and un-hides in one patch', () => {
    expect(buildRevealSidebarSectionPatch('agent', ['favorites'], ['recents', 'agent'])).toEqual({
      hiddenSidebarSections: ['recents'],
      sidebarExpandedKeys: ['favorites', 'agent'],
    });
  });

  it('returns null when the section is already visible', () => {
    expect(buildRevealSidebarSectionPatch('agent', ['recents', 'agent'], ['recents'])).toBeNull();
  });
});
