/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { advancedAction } from './advanced';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  // Every user gets the submenu shell; each child decides on its own whether
  // it applies (eval capture still checks its Labs flag).
  it('is the submenu shell for every user', () => {
    expect(build()).toMatchObject({ key: 'advanced', label: 'messageAction.advanced' });
  });
});
