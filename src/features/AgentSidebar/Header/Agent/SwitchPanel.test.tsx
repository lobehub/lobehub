/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SwitcherItem } from '@/features/NavPanel/switcher/switcherItems';

import SwitchPanel from './SwitchPanel';

const captured = vi.hoisted(() => ({ items: [] as SwitcherItem[], kind: '' as string }));
const rows = vi.hoisted(() => ({
  private: [] as Array<Record<string, unknown>>,
  workspace: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/Home/AgentSelect/useHomeAgentRows', () => ({
  useHomeAgentRows: () => ({ privateRows: rows.private, workspaceRows: rows.workspace }),
}));
vi.mock('@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl', () => ({
  resolvePreservedAgentUrl: vi.fn(),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useActiveLocation', () => ({ useActiveLocation: () => ({ pathname: '/' }) }));
vi.mock('@/hooks/useFetchAgentList', () => ({
  useFetchAgentList: () => ({ error: undefined, mutate: vi.fn() }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({ activeAgentId: 'a1' }),
}));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: { isAgentListInit: () => true },
}));
vi.mock('@/features/NavPanel/SidebarHeaderSelect', () => ({
  SidebarHeaderSelectPopover: ({
    children,
    content,
  }: {
    children: ReactNode;
    content: ReactNode;
  }) => (
    <div>
      {children}
      {content}
    </div>
  ),
}));
vi.mock('@/features/NavPanel/switcher/SwitcherMenu', () => ({
  default: ({ items, kind }: { items: SwitcherItem[]; kind: string }) => {
    captured.items = items;
    captured.kind = kind;
    return null;
  },
}));

describe('AgentSidebar SwitchPanel', () => {
  beforeEach(() => {
    captured.items = [];
    rows.private = [{ avatar: undefined, id: 'a1', title: 'Mine' }];
    rows.workspace = [
      { avatar: undefined, id: 'a2', title: 'Shared' },
      { avatar: '🤖', id: 'a3', title: 'Bot' },
    ];
  });

  // Agents without an avatar reach the switcher empty, keyed by id: the agent
  // switcher draws each one's generated character from that id, the same one the
  // header trigger shows.
  it('hands agents without an avatar to the agent switcher by id', () => {
    render(<SwitchPanel />);

    expect(captured.kind).toBe('agent');
    expect(captured.items.map((item) => [item.id, item.avatar])).toEqual([
      ['a1', undefined],
      ['a2', undefined],
      ['a3', '🤖'],
    ]);
  });
});
