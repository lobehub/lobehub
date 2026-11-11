import { render, renderHook, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const mockConfirmModal = vi.fn();

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      Select: ({
        classNames,
        options,
        value,
      }: {
        classNames?: { value?: string };
        options: { label: ReactNode; value: string }[];
        value?: string;
      }) => (
        <div data-testid="scope-select" data-value={value} data-value-class={classNames?.value}>
          {options.map((option) => (
            <div data-testid={`scope-option-${option.value}`} key={option.value}>
              {option.label}
            </div>
          ))}
        </div>
      ),
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
      confirmModal: (...args: unknown[]) => mockConfirmModal(...args),
    }),
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      createStaticStyles: () => ({
        backButton: 'backButton',
        card: 'card',
        emptyRow: 'emptyRow',
        rowIcon: 'rowIcon',
        rowIdentity: 'rowIdentity',
        scopeValue: 'scopeValue',
      }),
    }),
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  return merged;
});

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

const messengerState = {
  bindingScopes: [{ avatar: 'workspace-avatar', id: 'workspace-1', name: 'love' }],
  linksConfirmed: true,
};

vi.mock('@/store/messenger', () => ({
  messengerActions: {
    setActiveAgent: vi.fn(),
    uninstallInstallation: vi.fn(),
    unlink: vi.fn(),
    useFetchBindingScopes: vi.fn(),
  },
  messengerSelectors: {
    bindingScopes: (state: typeof messengerState) => state.bindingScopes,
    isLinksConfirmed: (state: typeof messengerState) => state.linksConfirmed,
  },
  useMessengerStore: (selector: (state: typeof messengerState) => unknown) =>
    selector(messengerState),
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

describe('Messenger UserAgentConnection with a restored link', () => {
  const restoredLink = {
    activeAgentId: 'agt_workspace',
    platformUserId: 'platform-user',
    platformUsername: 'platform-name',
    workspaceId: 'workspace-1' as string | null,
  };

  afterEach(() => {
    messengerState.linksConfirmed = true;
  });

  it('moves the scope picker to the scope the server link is bound to', () => {
    const { rerender } = render(
      <UserAgentConnection link={restoredLink} onSetActive={vi.fn()} onUnlink={vi.fn()} />,
    );
    expect(screen.getByTestId('scope-select')).toHaveAttribute('data-value', 'workspace-1');

    // Revalidation: the binding moved to the personal scope since the copy was saved.
    rerender(
      <UserAgentConnection
        link={{ ...restoredLink, activeAgentId: 'agt_personal', workspaceId: null }}
        onSetActive={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );

    expect(screen.getByTestId('scope-select')).toHaveAttribute('data-value', 'personal');
    // The picker shows the link's own agent, so nothing is auto-defaulted over it.
    expect(screen.getByTestId('agent-select')).toHaveAttribute('data-default-to-inbox', 'false');
  });

  it('does not default the binding to an inbox from a link the server has not confirmed', () => {
    messengerState.linksConfirmed = false;

    render(
      <UserAgentConnection
        link={{ ...restoredLink, activeAgentId: null, workspaceId: null }}
        onSetActive={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );

    expect(screen.getByTestId('agent-select')).toHaveAttribute('data-default-to-inbox', 'false');
  });
});

describe('useLinkActions handleUnlink', () => {
  const renderActions = (platform: 'wechat' | 'telegram', name: string) =>
    renderHook(() =>
      useLinkActions({
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
