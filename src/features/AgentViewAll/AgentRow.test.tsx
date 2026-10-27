/**
 * @vitest-environment happy-dom
 */
import type { SidebarAgentItem } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import AgentRow from './AgentRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className} data-testid={'identity-link'} href={'#'}>
      {children}
    </a>
  ),
}));

vi.mock('./AgentAvatar', () => ({ default: () => <span /> }));
vi.mock('./ItemActions', () => ({ default: () => <button type={'button'}>more</button> }));

const baseItem = {
  id: 'agt_cook',
  pinned: false,
  type: 'agent',
  // Older than 7 days, so the row prints a plain date instead of a relative one.
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} as unknown as SidebarAgentItem;

describe('AgentRow', () => {
  it('shows the name, role and responsibility as columns inside the identity link', () => {
    render(
      <AgentRow
        item={{
          ...baseItem,
          description: 'Reviews and merges community PRs',
          name: 'Cook',
          title: '公共CC(美国 100刀)',
        }}
      />,
    );

    const link = screen.getByTestId('identity-link');
    expect(link.textContent).toContain('Cook');
    expect(link.textContent).toContain('公共CC(美国 100刀)');
    expect(link.textContent).toContain('Reviews and merges community PRs');
  });

  it('leaves the role column empty when the title is already the primary label', () => {
    render(<AgentRow item={{ ...baseItem, description: null, title: 'LobeHub' }} />);

    const link = screen.getByTestId('identity-link');
    expect(screen.getAllByText('LobeHub')).toHaveLength(1);
    expect(link.textContent).toBe('LobeHub');
  });
});
