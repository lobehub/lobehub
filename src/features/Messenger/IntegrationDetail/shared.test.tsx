import { render, renderHook, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { messengerKeys } from '@/libs/swr/keys';

import { useLinkActions, UserAgentConnection } from './shared';

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
  Text: ({
    children,
    ellipsis,
  }: {
    children?: ReactNode;
    ellipsis?: boolean | { tooltip?: boolean | string };
  }) => (
    <span
      title={
        typeof ellipsis === 'object' && typeof ellipsis.tooltip === 'string'
          ? ellipsis.tooltip
          : undefined
      }
    >
      {children}
    </span>
  ),
}));

const mockConfirmModal = vi.fn();

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
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
  confirmModal: (...args: unknown[]) => mockConfirmModal(...args),
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
    rowIdentity: 'rowIdentity',
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
  default: ({ defaultToInbox }: { defaultToInbox?: boolean }) => (
    <div data-default-to-inbox={defaultToInbox} data-testid="agent-select" />
  ),
}));

describe('Messenger UserAgentConnection', () => {
  it('hides an opaque platform ID and exposes it through the account title tooltip', () => {
    render(
      <UserAgentConnection
        extraLabel="WeChat account"
        link={{
          activeAgentId: null,
          platformUserId: 'opaque-wechat-user-id',
          platformUsername: null,
          workspaceId: null,
        }}
        onSetActive={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );

    expect(screen.getByText('WeChat account')).toHaveAttribute('title', 'ID opaque-wechat-user-id');
    expect(screen.queryByText('ID opaque-wechat-user-id')).not.toBeInTheDocument();
  });

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

  it('defaults an agent-less personal connection to LobeAI', () => {
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

    expect(screen.getByTestId('agent-select')).toHaveAttribute('data-default-to-inbox', 'true');
  });
});

describe('useLinkActions handleUnlink', () => {
  const renderActions = (platform: 'wechat' | 'telegram', name: string) =>
    renderHook(() =>
      useLinkActions({
        installationsMutate: vi.fn(async () => undefined),
        linksMutate: vi.fn(async () => undefined),
        name,
        platform,
      }),
    );

  it('uses the QR-scan copy for WeChat — there is no /start command on WeChat', () => {
    const { result } = renderActions('wechat', 'WeChat');

    result.current.handleUnlink('tenant-1');

    expect(mockConfirmModal).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'messenger.unlinkConfirmWechat' }),
    );
  });

  it('keeps the generic /start copy for other platforms', () => {
    const { result } = renderActions('telegram', 'Telegram');

    result.current.handleUnlink('tenant-1');

    expect(mockConfirmModal).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'messenger.unlinkConfirm' }),
    );
  });
});
