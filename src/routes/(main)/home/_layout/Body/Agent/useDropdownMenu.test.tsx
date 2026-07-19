/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAgentActionsDropdownMenu } from './useDropdownMenu';

const updateSystemStatusMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/routes/(main)/home/_layout/Body/CustomizeSidebarModal', () => ({
  openCustomizeSidebarModal: vi.fn(),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      agentPageSize: 10,
      updateSystemStatus: updateSystemStatusMock,
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    agentPageSize: (state: { agentPageSize: number }) => state.agentPageSize,
  },
}));

vi.mock('../../hooks', () => ({
  useCreateMenuItems: () => ({
    configMenuItem: () => ({ key: 'config', label: 'sessionGroup.manageCategory' }),
    createSessionGroupMenuItem: () => ({ key: 'addSessionGroup' }),
  }),
}));

describe('useAgentActionsDropdownMenu', () => {
  it('omits section reordering from the Agent category header', () => {
    const { result } = renderHook(() =>
      useAgentActionsDropdownMenu({ openConfigGroupModal: vi.fn() }),
    );

    const keys = result.current?.flatMap((item) =>
      item && typeof item === 'object' && 'key' in item && item.key ? [item.key] : [],
    );

    expect(keys).toEqual(['addSessionGroup', 'config', 'show', 'customizeSidebar']);
    expect(keys).not.toContain('moveUp');
    expect(keys).not.toContain('moveDown');
  });
});
