/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import GroupConversation from './GroupConversation';

const menu = vi.hoisted(() => ({ anchors: [] as (HTMLElement | null)[] }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/AgentGroupAvatar', () => ({ default: () => null }));
vi.mock('@/features/HomeSidebar/Body/Agent/List/AgentGroupItem/useDropdownMenu', () => ({
  useGroupDropdownMenu: ({ anchor }: { anchor: HTMLElement | null }) => {
    menu.anchors.push(anchor);
    return () => [];
  },
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ ref, to: _to, ...rest }: { ref?: (el: HTMLElement | null) => void; to: string }) =>
    createElement('a', { ...rest, ref }),
}));

describe('GroupConversation', () => {
  it('anchors the row menu (inline rename) on the row element', async () => {
    const { container } = render(
      createElement(GroupConversation, {
        active: false,
        conversation: {
          activeAt: new Date(),
          item: { id: 'cg_1', pinned: false, title: 'Group', type: 'group', updatedAt: new Date() },
        } as never,
      }),
    );

    const row = container.querySelector('a');
    await waitFor(() => expect(menu.anchors.at(-1)).toBe(row));
  });
});
