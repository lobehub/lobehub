import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearNavPanelRegistry,
  registerNavPanelContent,
  unregisterNavPanelContent,
} from '@/features/NavPanel/registry';

import { useNavPanelDrawerContent } from './useNavPanelDrawerContent';

const mocks = vi.hoisted(() => ({ pathname: '/memory' }));

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: mocks.pathname }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));

beforeEach(() => {
  mocks.pathname = '/memory';
  clearNavPanelRegistry();
});

describe('useNavPanelDrawerContent', () => {
  it('is empty until the route registers its sidebar', () => {
    const owner = Symbol('memory-sidebar');
    const sidebar = createElement('nav', null, 'memory sections');
    const { result } = renderHook(() => useNavPanelDrawerContent());

    expect(result.current).toBeUndefined();

    act(() => registerNavPanelContent('memory', owner, sidebar));
    expect(result.current).toBe(sidebar);

    act(() => unregisterNavPanelContent('memory', owner));
    expect(result.current).toBeUndefined();
  });

  it('ignores sidebars other routes registered', () => {
    registerNavPanelContent('resource', Symbol('resource-sidebar'), 'resource sidebar');

    expect(renderHook(() => useNavPanelDrawerContent()).result.current).toBeUndefined();
  });

  // `useNavPanelDrawerContent` skips `home` on purpose (`navKey === 'home'`): the
  // home route's registered sidebar is the agent list mobile already renders
  // as the page itself.
  it('skips the home route sidebar while serving other routes from the same registry', () => {
    mocks.pathname = '/';
    registerNavPanelContent('home', Symbol('home-sidebar'), 'agent list');
    registerNavPanelContent('memory', Symbol('memory-sidebar'), 'memory sections');

    expect(renderHook(() => useNavPanelDrawerContent()).result.current).toBeUndefined();

    // The same registry still serves another route's sidebar.
    mocks.pathname = '/memory';
    expect(renderHook(() => useNavPanelDrawerContent()).result.current).toBe('memory sections');
  });

  // The desktop rail folds agent chats into the conversation list (`home`);
  // mobile has no rail, so the agent route must keep serving its own sidebar.
  it('serves the agent sidebar on an agent chat route', () => {
    mocks.pathname = '/agent/agent-1';
    registerNavPanelContent('home', Symbol('home-sidebar'), 'agent list');
    registerNavPanelContent('agent', Symbol('agent-sidebar'), 'agent topics');

    expect(renderHook(() => useNavPanelDrawerContent()).result.current).toBe('agent topics');
  });
});
