import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { messengerKeys } from '@/libs/swr/keys';

import { UserAgentConnection } from './shared';

const userState = {
  isSignedIn: true,
  user: {
    avatar: 'user-avatar',
    email: 'demo@example.com',
    fullName: 'Demo Name',
    username: 'demo-user',
  },
};

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar }: { avatar?: string }) => <span data-avatar={avatar} />,
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Skeleton: () => <span />,
  Tag: ({ children }: { children?: ReactNode }) => (
    <span data-testid="personal-tag">{children}</span>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: ({
    classNames,
    options,
  }: {
    classNames?: { value?: string };
    options: { label: ReactNode; value: string }[];
  }) => (
    <div data-testid="scope-select" data-value-class={classNames?.value}>
      {options.map((option) => (
        <div data-testid={`scope-option-${option.value}`} key={option.value}>
          {option.label}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { error: vi.fn(), success: vi.fn() } }),
  },
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    backButton: 'backButton',
    card: 'card',
    emptyRow: 'emptyRow',
    rowIcon: 'rowIcon',
    scopeValue: 'scopeValue',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      ({
        'messenger.activeAgent': 'Active agent',
        'messenger.activeAgentPlaceholder': 'Select agent',
        'messenger.detail.connections.userLabel': 'User',
        'messenger.detail.disconnect': 'Disconnect',
        'messenger.scope': 'Scope',
        'messenger.scopePersonal': '个人',
      })[key] ??
      options?.defaultValue ??
      key,
  }),
}));

vi.mock('swr', () => ({
  default: (key: unknown) => ({
    data:
      Array.isArray(key) && key[0] === messengerKeys.bindingScopes.root
        ? [{ avatar: 'workspace-avatar', id: 'workspace-1', name: 'love' }]
        : undefined,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/services/messenger', () => ({
  messengerService: {
    listBindingScopes: vi.fn(),
  },
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: () => true,
  },
  useServerConfigStore: (
    selector: (state: { featureFlags: { enableWorkspace: boolean } }) => unknown,
  ) => selector({ featureFlags: { enableWorkspace: true } }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) => selector(userState),
}));

vi.mock('../AgentSelect', () => ({
  default: () => <div data-testid="agent-select" />,
}));

describe('Messenger UserAgentConnection', () => {
  it('uses the signed-in full name for the personal scope and shows the personal tag', () => {
    render(
      <UserAgentConnection
        link={{
          activeAgentId: null,
          platformUserId: 'platform-user',
          platformUsername: 'platform-name',
          workspaceId: null,
        }}
        onSetActive={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );

    const personalOption = screen.getByTestId('scope-option-personal');

    expect(within(personalOption).getByText('Demo Name')).toBeInTheDocument();
    expect(within(personalOption).queryByText('demo-user')).not.toBeInTheDocument();
    expect(within(personalOption).getByTestId('personal-tag')).toHaveTextContent('personal');
    expect(within(personalOption).queryByText('个人')).not.toBeInTheDocument();
    expect(screen.getByTestId('scope-select')).toHaveAttribute('data-value-class', 'scopeValue');
  });
});
