/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { advancedAction } from './advanced';

const mocks = vi.hoisted(() => ({ isDevMode: true }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    config: () => ({ isDevMode: mocks.isDevMode }),
  },
}));

const build = () =>
  renderHook(() =>
    advancedAction.useBuild({
      data: { content: 'Hello', role: 'assistant' } as UIChatMessage,
      id: 'message-1',
      role: 'assistant',
    }),
  ).result.current;

describe('advancedAction', () => {
  beforeEach(() => {
    mocks.isDevMode = true;
  });

  // The drawer is developer-facing as a whole, so the gate lives here rather
  // than on each child — this is what keeps a Labs-only child (capturing an
  // eval case) out of an ordinary user's menu.
  it('is absent when Advanced Tools (dev mode) is off', () => {
    mocks.isDevMode = false;

    expect(build()).toBeNull();
  });

  it('is the submenu shell when Advanced Tools is on', () => {
    expect(build()).toMatchObject({ key: 'advanced', label: 'messageAction.advanced' });
  });
});
