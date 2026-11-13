import { describe, expect, it } from 'vitest';

import { artboardIdOfTab, artboardTabKey } from '@/store/global/initialState';

import { isArtboardTab, isDynamicTab, isWorkTab } from './dynamicTabs';

describe('artboard tabs', () => {
  it('round-trips an artboard id through its tab key', () => {
    expect(artboardIdOfTab(artboardTabKey('art_1'))).toBe('art_1');
    expect(artboardIdOfTab('canvas:cvs_1')).toBeUndefined();
  });

  it('belongs to one conversation, like a canvas tab', () => {
    const tab = artboardTabKey('art_1');
    expect(isArtboardTab(tab)).toBe(true);
    expect(isDynamicTab(tab)).toBe(true);
    expect(isWorkTab(tab)).toBe(true);
    expect(isWorkTab('canvas:cvs_1')).toBe(true);
    expect(isWorkTab('files')).toBe(false);
  });
});
