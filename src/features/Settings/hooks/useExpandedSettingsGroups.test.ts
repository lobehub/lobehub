import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useExpandedSettingsGroups } from './useExpandedSettingsGroups';

const groups = [
  { items: [{ key: 'profile' }], key: 'account' },
  { items: [{ key: 'about' }, { key: 'labs' }], key: 'system' },
];

const setup = (activeTab: string) =>
  renderHook((tab: string) => useExpandedSettingsGroups(groups, tab, 'system'), {
    initialProps: activeTab,
  });

describe('useExpandedSettingsGroups', () => {
  it('starts the collapsed group closed on any other page', () => {
    expect(setup('profile').result.current.expandedGroups).toEqual(['account']);
  });

  it('opens the collapsed group on a deep link into it', () => {
    expect(setup('about').result.current.expandedGroups).toEqual(['account', 'system']);
  });

  it('reopens the group when navigation moves into it', () => {
    const { rerender, result } = setup('profile');

    rerender('labs');

    expect(result.current.expandedGroups).toEqual(['account', 'system']);
  });

  it('keeps a group the user collapsed on its own page closed', () => {
    const { result } = setup('about');

    act(() => result.current.onExpandedGroupsChange(['account']));

    expect(result.current.expandedGroups).toEqual(['account']);
  });

  it('opens the collapsed group when the active entry appears after first render', () => {
    const { rerender, result } = renderHook(
      (list: typeof groups) => useExpandedSettingsGroups(list, 'apikey', 'system'),
      { initialProps: groups },
    );

    expect(result.current.expandedGroups).toEqual(['account']);

    rerender([groups[0], { items: [{ key: 'apikey' }], key: 'system' }]);

    expect(result.current.expandedGroups).toEqual(['account', 'system']);
  });

  it('opens a group that appears after first render', () => {
    const { rerender, result } = renderHook(
      (list: typeof groups) => useExpandedSettingsGroups(list, 'profile', 'system'),
      { initialProps: groups },
    );

    rerender([...groups, { items: [{ key: 'storage' }], key: 'admin' }]);

    expect(result.current.expandedGroups).toEqual(['account', 'admin']);
  });
});
