import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useContactCard } from './useContactCard';

const fetch = vi.hoisted(() => ({ error: undefined as unknown, mutate: vi.fn() }));
const agentList = vi.hoisted(() => ({ init: true, items: [] as { id: string }[] }));
const access = vi.hoisted(() => ({ canEdit: true }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: () => fetch }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: access.canEdit }),
}));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    getAgentById: (id: string) => () => agentList.items.find((item) => item.id === id),
    isAgentListInit: () => agentList.init,
  },
}));

beforeEach(() => {
  fetch.error = undefined;
  fetch.mutate.mockReset();
  access.canEdit = true;
  agentList.init = true;
  agentList.items = [
    { id: 'agt_1', name: 'Ada', slug: 'ada', title: 'Product Helper' },
    { id: 'grp_1', title: 'Launch Crew', type: 'group' },
  ] as { id: string }[];
});

describe('useContactCard', () => {
  it('opens an agent chat and its profile editor', () => {
    const { result } = renderHook(() => useContactCard('agt_1'));

    expect(result.current).toMatchObject({
      canEdit: true,
      chatUrl: '/agent/agt_1',
      profileUrl: '/agent/agt_1/profile',
      role: 'Product Helper',
      slug: 'ada',
      status: 'ready',
      title: 'Ada',
    });
  });

  it('opens a group chat and the group profile', () => {
    const { result } = renderHook(() => useContactCard('grp_1'));

    expect(result.current).toMatchObject({
      chatUrl: '/group/grp_1',
      profileUrl: '/group/grp_1/profile',
      role: undefined,
      status: 'ready',
      title: 'Launch Crew',
    });
  });

  it('does not offer the profile editor to viewers who cannot edit', () => {
    access.canEdit = false;

    const { result } = renderHook(() => useContactCard('agt_1'));

    expect(result.current).toMatchObject({ canEdit: false, status: 'ready' });
  });

  it('waits for the first load, then reports a contact that is not in the list', () => {
    agentList.init = false;
    expect(renderHook(() => useContactCard('agt_missing')).result.current.status).toBe('loading');

    agentList.init = true;
    expect(renderHook(() => useContactCard('agt_missing')).result.current.status).toBe('missing');
  });

  it('turns a failed first load into a retry instead of an endless skeleton', () => {
    agentList.init = false;
    agentList.items = [];
    fetch.error = new Error('429');

    const { result } = renderHook(() => useContactCard('agt_1'));

    expect(result.current.status).toBe('error');
    if (result.current.status === 'error') result.current.retry();
    expect(fetch.mutate).toHaveBeenCalled();
  });
});
