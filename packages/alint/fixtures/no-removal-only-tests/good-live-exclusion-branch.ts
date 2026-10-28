// Fixture: the excluded case of a hook's own branch, asserted on its own.
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { clearPanelRegistry, registerPanelContent } from './registry';
import { usePanelDrawerContent } from './usePanelDrawerContent';

const mocks = vi.hoisted(() => ({ navKey: 'memory' }));

vi.mock('./useActiveNavKey', () => ({ useActiveNavKey: () => mocks.navKey }));

beforeEach(() => {
  mocks.navKey = 'memory';
  clearPanelRegistry();
});

it('opens the sidebar the active route registered', () => {
  registerPanelContent('memory', Symbol('memory'), 'memory sections');
  expect(renderHook(() => usePanelDrawerContent()).result.current).toBe('memory sections');
});

it('never offers the desktop home sidebar, which mobile shows as its home page', () => {
  mocks.navKey = 'home';
  registerPanelContent('home', Symbol('home'), 'agent list');

  expect(renderHook(() => usePanelDrawerContent()).result.current).toBeUndefined();
});
