import { describe, expect, it } from 'vitest';

import { resolveCloseShortcut } from './resolveCloseShortcut';
import { PERSONAL_TAB_SCOPE } from './scope';
import { type TabItem } from './types';

const tab = (id: string, url: string): TabItem => ({ id, lastVisited: 1, url });

describe('resolveCloseShortcut', () => {
  it('closes the active tab when several are open', () => {
    const tabs = [tab('a', '/agent/a1'), tab('b', '/')];

    expect(resolveCloseShortcut(tabs, 'a', PERSONAL_TAB_SCOPE)).toEqual({
      id: 'a',
      type: 'closeTab',
    });
  });

  it('closes a lone tab that is not at home, so it lands on the home tab', () => {
    const tabs = [tab('a', '/agent/a1?topic=t1')];

    expect(resolveCloseShortcut(tabs, 'a', PERSONAL_TAB_SCOPE)).toEqual({
      id: 'a',
      type: 'closeTab',
    });
  });

  it('closes the window when the lone tab is already at home', () => {
    expect(resolveCloseShortcut([tab('a', '/')], 'a', PERSONAL_TAB_SCOPE)).toEqual({
      type: 'closeWindow',
    });
  });

  it('treats the workspace root as home inside a workspace scope', () => {
    const scope = { slug: 'acme', type: 'workspace' } as const;

    expect(resolveCloseShortcut([tab('a', '/acme')], 'a', scope)).toEqual({
      type: 'closeWindow',
    });
    expect(resolveCloseShortcut([tab('a', '/')], 'a', scope)).toEqual({
      id: 'a',
      type: 'closeTab',
    });
  });

  it('closes the window when no tab is active', () => {
    expect(resolveCloseShortcut([], null, PERSONAL_TAB_SCOPE)).toEqual({ type: 'closeWindow' });
  });
});
