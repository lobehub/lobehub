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

vi.mock('react-router-dom', () => ({
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
  useOptionalAgentModal: () => undefined,
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
    selector({
      enableHeterogeneousAgent: true,
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableHeterogeneousAgent: (state: Record<string, boolean>) => state.enableHeterogeneousAgent,
  },
}));

const isActionItem = (
  item: unknown,
): item is {
  key: string;
  onClick?: (info: { domEvent?: { stopPropagation?: () => void } }) => Promise<void>;
} => !!item && typeof item === 'object' && 'key' in item;

describe('useCreateMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        systemRole: '',
        title: 'Codex',
      },
      groupId: undefined,
    });
    expect(refreshAgentListMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-codex');
  });
});
