/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreateMenuItems } from './useCreateMenuItems';

const createAgentMock = vi.hoisted(() => vi.fn().mockResolvedValue({ agentId: 'agent-codex' }));
const refreshAgentListMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const addGroupMock = vi.hoisted(() => vi.fn());
const switchToGroupMock = vi.hoisted(() => vi.fn());
const createGroupMock = vi.hoisted(() => vi.fn());
const loadGroupsMock = vi.hoisted(() => vi.fn());
const createNewPageMock = vi.hoisted(() => vi.fn());
const messageErrorMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const openCreateGroupModalMock = vi.hoisted(() => vi.fn());
const agentModalMock = vi.hoisted(() => ({
  current: undefined as { openCreateGroupModal: (id?: string, v?: string) => void } | undefined,
}));

vi.mock('@lobechat/const', () => ({
  isDesktop: true,
}));

vi.mock('@lobechat/heterogeneous-agents/client', () => ({
  HETEROGENEOUS_AGENT_CLIENT_CONFIGS: [
    {
      avatar: 'claude-avatar',
      command: 'claude',
      icon: () => null,
      iconId: 'ClaudeCode',
      menuKey: 'newClaudeCodeAgent',
      menuLabelKey: 'newClaudeCodeAgent',
      title: 'Claude Code',
      type: 'claude-code',
    },
    {
      avatar: 'avatar',
      command: 'codex',
      icon: () => null,
      iconId: 'Codex',
      menuKey: 'newCodexAgent',
      menuLabelKey: 'newCodexAgent',
      title: 'Codex',
      type: 'codex',
    },
    {
      avatar: 'amp-avatar',
      command: 'amp',
      icon: () => null,
      iconId: 'Amp',
      menuKey: 'newAmpAgent',
      menuLabelKey: 'newAmpAgent',
      title: 'Amp',
      type: 'amp',
    },
    {
      avatar: 'opencode-avatar',
      command: 'opencode',
      icon: () => null,
      iconId: 'OpenCode',
      menuKey: 'newOpenCodeAgent',
      menuLabelKey: 'newOpenCodeAgent',
      title: 'OpenCode',
      type: 'opencode',
    },
  ],
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('@lobehub/ui/icons', () => ({
  GroupBotSquareIcon: () => null,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: messageErrorMock },
      notification: { error: vi.fn() },
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('swr/mutation', () => ({
  default: () => ({
    isMutating: false,
    trigger: vi.fn(),
  }),
}));

vi.mock('@/components/ChatGroupWizard/templates', () => ({
  useGroupTemplates: () => [],
}));

vi.mock('@/routes/(main)/home/_layout/Body/Agent/ModalProvider', () => ({
  useOptionalAgentModal: () => agentModalMock.current,
}));

vi.mock('@/services/chatGroup', () => ({
  chatGroupService: {
    createGroupWithMembers: vi.fn(),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createAgent: createAgentMock,
    }),
}));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createGroup: createGroupMock,
      loadGroups: loadGroupsMock,
    }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      addGroup: addGroupMock,
      refreshAgentList: refreshAgentListMock,
      switchToGroup: switchToGroupMock,
    }),
}));

vi.mock('@/store/page', () => ({
  usePageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createNewPage: createNewPageMock,
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ preference: { lab: {} } }),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enablePlatformAgent: () => false,
  },
}));

const isActionItem = (
  item: unknown,
): item is {
  label?: unknown;
  key: string;
  onClick?: (info: { domEvent?: { stopPropagation?: () => void } }) => Promise<void> | void;
} => !!item && typeof item === 'object' && 'key' in item;

describe('useCreateMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentModalMock.current = undefined;
  });

  it('adds Agent-list and Market entries while omitting Page creation', async () => {
    const { result } = renderHook(() => useCreateMenuItems());

    const items = result.current.createTopLevelMenuItems();
    const itemKeys = items.map((item) =>
      isActionItem(item)
        ? item.key
        : item && typeof item === 'object' && 'type' in item
          ? item.type
          : item,
    );

    expect(itemKeys).toEqual([
      'newAgent',
      'newGroupChat',
      'divider',
      'newClaudeCodeAgent',
      'newCodexAgent',
      'newAmpAgent',
      'newOpenCodeAgent',
      'divider',
      'addAgentFromList',
      'addAgentFromMarket',
    ]);

    const listItem = items.find((item) => isActionItem(item) && item.key === 'addAgentFromList');

    if (!isActionItem(listItem)) {
      throw new Error('Expected Agent-list menu item');
    }

    expect(listItem.label).toBe('addAgentFromList');

    const listStopPropagation = vi.fn();
    await act(async () => {
      await listItem.onClick?.({ domEvent: { stopPropagation: listStopPropagation } });
    });

    expect(listStopPropagation).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/agents');

    const marketItem = items.find(
      (item) => isActionItem(item) && item.key === 'addAgentFromMarket',
    );

    if (!isActionItem(marketItem)) {
      throw new Error('Expected market agent menu item');
    }

    expect(marketItem.label).toBe('addAgentFromMarket');

    const stopPropagation = vi.fn();
    navigateMock.mockClear();
    await act(async () => {
      await marketItem.onClick?.({ domEvent: { stopPropagation } });
    });

    expect(stopPropagation).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/community/agent');
  });

  it('opens the agent list on the Private tab for the private bucket', async () => {
    const { result } = renderHook(() => useCreateMenuItems());

    const listItem = result.current.createAgentListMenuItem({ visibility: 'private' });

    if (!isActionItem(listItem)) {
      throw new Error('Expected Agent-list menu item');
    }

    expect(listItem.key).toBe('addPrivateAgentFromList');

    navigateMock.mockClear();
    await act(async () => {
      await listItem.onClick?.({ domEvent: { stopPropagation: vi.fn() } });
    });

    expect(navigateMock).toHaveBeenCalledWith('/agents?tab=private');
  });

  it('opens the naming modal when creating a category inside the modal provider', async () => {
    agentModalMock.current = { openCreateGroupModal: openCreateGroupModalMock };

    const { result } = renderHook(() => useCreateMenuItems());

    const groupItem = result.current.createSessionGroupMenuItem({ visibility: 'private' });

    if (!isActionItem(groupItem)) {
      throw new Error('Expected session group menu item');
    }

    await act(async () => {
      await groupItem.onClick?.({ domEvent: { stopPropagation: vi.fn() } });
    });

    expect(openCreateGroupModalMock).toHaveBeenCalledWith(undefined, 'private');
    expect(addGroupMock).not.toHaveBeenCalled();
  });

  it('falls back to default-name creation without the modal provider', async () => {
    const { result } = renderHook(() => useCreateMenuItems());

    const groupItem = result.current.createSessionGroupMenuItem();

    if (!isActionItem(groupItem)) {
      throw new Error('Expected session group menu item');
    }

    await act(async () => {
      await groupItem.onClick?.({ domEvent: { stopPropagation: vi.fn() } });
    });

    expect(addGroupMock).toHaveBeenCalledWith('sessionGroup.newGroup', undefined);
    expect(openCreateGroupModalMock).not.toHaveBeenCalled();
  });

  it('uses an action-oriented label for category management', () => {
    const { result } = renderHook(() => useCreateMenuItems());

    const configItem = result.current.configMenuItem(vi.fn());

    if (!isActionItem(configItem)) {
      throw new Error('Expected category management menu item');
    }

    expect(configItem.label).toBe('sessionGroup.manageCategory');
  });

  it('creates the Claude Code agent normally when the CLI is available', async () => {
    const { result } = renderHook(() => useCreateMenuItems());

    const claudeItem = result.current
      .createHeterogeneousAgentMenuItems()
      .find((item) => isActionItem(item) && item.key === 'newClaudeCodeAgent');

    if (!isActionItem(claudeItem)) {
      throw new Error('Expected Claude Code menu item');
    }

    await act(async () => {
      await claudeItem.onClick?.({ domEvent: { stopPropagation: vi.fn() } });
    });

    expect(createAgentMock).toHaveBeenCalledWith({
      config: {
        agencyConfig: {
          heterogeneousProvider: {
            command: 'claude',
            type: 'claude-code',
          },
        },
        avatar: 'claude-avatar',
        provider: 'claude-code',
        systemRole: '',
        title: 'Claude Code',
      },
      groupId: undefined,
    });
    expect(refreshAgentListMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-codex');
  });

  it('creates the Codex agent normally without preflight interception', async () => {
    const { result } = renderHook(() => useCreateMenuItems());

    const codexItem = result.current
      .createHeterogeneousAgentMenuItems()
      .find((item) => isActionItem(item) && item.key === 'newCodexAgent');

    if (!isActionItem(codexItem)) {
      throw new Error('Expected Codex menu item');
    }

    await act(async () => {
      await codexItem.onClick?.({ domEvent: { stopPropagation: vi.fn() } });
    });

    expect(createAgentMock).toHaveBeenCalledWith({
      config: {
        agencyConfig: {
          heterogeneousProvider: {
            command: 'codex',
            type: 'codex',
          },
        },
        avatar: 'avatar',
        provider: 'codex',
        systemRole: '',
        title: 'Codex',
      },
      groupId: undefined,
    });
    expect(refreshAgentListMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-codex');
  });

  it('creates AMP as an independent local CLI agent', async () => {
    const { result } = renderHook(() => useCreateMenuItems());

    const ampItem = result.current
      .createHeterogeneousAgentMenuItems()
      .find((item) => isActionItem(item) && item.key === 'newAmpAgent');

    if (!isActionItem(ampItem)) throw new Error('Expected AMP menu item');

    await act(async () => {
      await ampItem.onClick?.({ domEvent: { stopPropagation: vi.fn() } });
    });

    expect(createAgentMock).toHaveBeenCalledWith({
      config: {
        agencyConfig: { heterogeneousProvider: { command: 'amp', type: 'amp' } },
        avatar: 'amp-avatar',
        provider: 'amp',
        systemRole: '',
        title: 'Amp',
      },
      groupId: undefined,
    });
  });

  it('creates OpenCode as an independent local CLI agent', async () => {
    const { result } = renderHook(() => useCreateMenuItems());

    const openCodeItem = result.current
      .createHeterogeneousAgentMenuItems()
      .find((item) => isActionItem(item) && item.key === 'newOpenCodeAgent');

    if (!isActionItem(openCodeItem)) throw new Error('Expected OpenCode menu item');

    await act(async () => {
      await openCodeItem.onClick?.({ domEvent: { stopPropagation: vi.fn() } });
    });

    expect(createAgentMock).toHaveBeenCalledWith({
      config: {
        agencyConfig: {
          heterogeneousProvider: { command: 'opencode', type: 'opencode' },
        },
        avatar: 'opencode-avatar',
        provider: 'opencode',
        systemRole: '',
        title: 'OpenCode',
      },
      groupId: undefined,
    });
  });
});
