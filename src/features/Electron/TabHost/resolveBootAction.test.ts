import { describe, expect, it } from 'vitest';

import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';

import { resolveBootAction } from './resolveBootAction';

const tab = (id: string, url: string): TabItem => ({ id, lastVisited: 1, url });

describe('resolveBootAction', () => {
  it('keeps the persisted active tab on a default `/` launch', () => {
    const tabs = [tab('a', '/agent/x'), tab('b', '/image')];

    expect(resolveBootAction(tabs, 'b', '/')).toEqual({ type: 'keep' });
  });

  it('does not keep when the default launch has no valid persisted active tab', () => {
    const tabs = [tab('a', '/agent/x')];

    // Stale active id → falls through to matching, then add.
    expect(resolveBootAction(tabs, 'missing', '/')).toEqual({ type: 'add', url: '/' });
  });

  it('activates a matching tab that is not the active one for a deep-link boot', () => {
    const tabs = [tab('a', '/agent/x'), tab('b', '/image')];

    expect(resolveBootAction(tabs, 'a', '/image')).toEqual({ id: 'b', type: 'activate' });
  });

  it('carries the launch anchor onto a matching tab parked at another fragment', () => {
    const tabs = [tab('a', '/agent/x#msg_1'), tab('b', '/image')];

    expect(resolveBootAction(tabs, 'b', '/agent/x#msg_2')).toEqual({
      id: 'a',
      type: 'activate',
      url: '/agent/x#msg_2',
    });
  });

  it('carries the launch anchor onto a matching tab that has no fragment', () => {
    const tabs = [tab('a', '/settings/agent')];

    expect(resolveBootAction(tabs, 'a', '/settings/agent#llm')).toEqual({
      id: 'a',
      type: 'activate',
      url: '/settings/agent#llm',
    });
  });

  it('adds a tab when the boot url matches nothing', () => {
    const tabs = [tab('a', '/agent/x')];

    expect(resolveBootAction(tabs, 'a', '/memory')).toEqual({ type: 'add', url: '/memory' });
  });

  it('adds a tab for the boot url when the store is empty', () => {
    expect(resolveBootAction([], null, '/agent/x')).toEqual({ type: 'add', url: '/agent/x' });
  });

  it('adds a home tab on a default launch with an empty store', () => {
    expect(resolveBootAction([], null, '/')).toEqual({ type: 'add', url: '/' });
  });

  it('activates a matching `/` tab when there is no persisted active tab', () => {
    const tabs = [tab('a', '/'), tab('b', '/image')];

    expect(resolveBootAction(tabs, null, '/')).toEqual({ id: 'a', type: 'activate' });
  });

  it('keeps the persisted active tab on a workspace scope-root launch', () => {
    const tabs = [tab('a', '/acme/agent/x'), tab('b', '/acme')];

    expect(resolveBootAction(tabs, 'a', '/acme')).toEqual({ type: 'keep' });
  });

  it('adds a workspace home tab on a scope-root launch with an empty scope store', () => {
    expect(resolveBootAction([], null, '/acme')).toEqual({ type: 'add', url: '/acme' });
  });

  it('still treats a workspace deep link as a deep link, not a default launch', () => {
    const tabs = [tab('a', '/acme'), tab('b', '/acme/image')];

    expect(resolveBootAction(tabs, 'a', '/acme/image')).toEqual({ id: 'b', type: 'activate' });
  });
});
