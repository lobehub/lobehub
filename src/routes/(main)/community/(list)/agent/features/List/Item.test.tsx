// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DiscoverAssistantItem } from '@/types/discover';

import AssistantItem from './Item';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar }: { avatar?: string }) => <div data-avatar={avatar} />,
  Block: ({
    children,
    onClick,
  }: {
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
  }) => (
    <div data-testid="assistant-item" onClick={onClick}>
      {children}
    </div>
  ),
  Flexbox: ({
    children,
    onClick,
  }: {
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLDivElement>;
  }) => <div onClick={onClick}>{children}</div>,
  Icon: () => <span />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/PublishedTime', () => ({
  default: ({ date }: { date?: string }) => <span>{date}</span>,
}));

vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/hooks/useQuery', () => ({
  useQuery: () => ({}),
}));

vi.mock('@/services/discover', () => ({
  discoverService: {
    reportAgentEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

const item = {
  author: 'LobeHub',
  avatar: 'avatar',
  category: 'life',
  createdAt: '2026-05-29',
  description: 'description',
  identifier: 'jailbreak-mode',
  title: 'Jailbreak Mode',
  tokenUsage: 138,
  userName: 'lobehub',
} as DiscoverAssistantItem;

describe('AssistantItem', () => {
  it('opens the user author profile in a new tab outside workspace scope', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<AssistantItem {...item} />);

    try {
      fireEvent.click(screen.getByText('LobeHub'));

      expect(openSpy).toHaveBeenCalledWith(
        '/community/user/lobehub',
        '_blank',
        'noopener,noreferrer',
      );
      expect(mocks.navigate).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });

  it('opens the organization author profile in a new tab outside workspace scope', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <AssistantItem {...item} author="Acme Labs" ownerType="organization" userName="acme-labs" />,
    );

    try {
      fireEvent.click(screen.getByText('Acme Labs'));

      expect(openSpy).toHaveBeenCalledWith(
        '/community/org/acme-labs',
        '_blank',
        'noopener,noreferrer',
      );
      expect(mocks.navigate).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });
});
