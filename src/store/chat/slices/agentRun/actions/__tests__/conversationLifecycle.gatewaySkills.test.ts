import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { getSessionStoreState } from '@/store/session';
import * as toolStoreModule from '@/store/tool';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
import { createMockAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

vi.mock('../transports/hetero/heterogeneousAgentExecutor', () => ({
  executeHeterogeneousAgent: vi.fn(),
}));

vi.mock('@/store/tool/slices/builtin/loadBuiltinSkills', () => ({
  loadBuiltinSkill: async (identifier: string) =>
    toolStoreModule
      .getToolStoreState()
      .builtinSkills.find((skill: any) => skill.identifier === identifier),
  loadBuiltinSkills: async () => toolStoreModule.getToolStoreState().builtinSkills,
}));

// Mock lambdaClient to prevent network requests
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    session: {
      updateSession: {
        mutate: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
  useUserStore.setState({ workspaceUserPreference: {} });

  act(() => {
    useChatStore.setState({
      executeClientAgent: vi.fn(),
      mainInputEditor: null,
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const skillTag = (actionType: string, actionLabel: string) => ({
  actionCategory: 'skill',
  actionLabel,
  actionType,
  type: 'action-tag',
});

describe('sendMessage in gateway mode', () => {
  // ROOT CAUSE:
  //
  // In gateway mode, a skill picked in the composer reached the server only as
  // `<skill name="…" />` text in the prompt, because the gateway request carried
  // tool and agent mentions but no skill field.
  //
  // Before the fix, the server run never injected the skill body.
  // The fix forwards the picks as `selectedSkillIds`.
  it('forwards library and filesystem skill chips to the gateway', async () => {
    const { result } = renderHook(() => useChatStore());
    const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
      assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
      operationId: 'op-skill',
      userMessageId: TEST_IDS.USER_MESSAGE_ID,
    });

    vi.spyOn(toolStoreModule, 'getToolStoreState').mockReturnValue({
      agentSkillDetailMap: {},
      agentSkills: [],
      builtinSkills: [
        {
          content: 'Audit the page for UX issues.',
          description: 'UX audit',
          identifier: 'ux-audit',
          name: 'UX Audit',
          source: 'builtin',
        },
      ],
    } as any);
    act(() => {
      useChatStore.setState({
        executeGatewayAgent: executeGatewayAgentSpy,
        isGatewayModeEnabled: () => true,
      });
    });

    await act(async () => {
      await result.current.sendMessage({
        context: { agentId: TEST_IDS.SESSION_ID, threadId: null, topicId: null },
        editorData: {
          root: {
            children: [
              {
                children: [
                  skillTag('ux-audit', 'UX Audit'),
                  { ...skillTag('local-audit', 'Local Audit'), actionCategory: 'projectSkill' },
                  { text: ' review the page', type: 'text' },
                  skillTag('ux-audit', 'UX Audit'),
                ],
                type: 'paragraph',
              },
            ],
            type: 'root',
          },
        },
        message:
          '<skill name="ux-audit" label="UX Audit" /> <projectSkill name="local-audit" label="Local Audit" /> review the page',
      });
    });

    expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
      expect.objectContaining({ selectedSkillIds: ['ux-audit', 'projectSkill:local-audit'] }),
    );
  });

  it('sends no skill field when nothing was selected', async () => {
    const { result } = renderHook(() => useChatStore());
    const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
      assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
      operationId: 'op-plain',
      userMessageId: TEST_IDS.USER_MESSAGE_ID,
    });

    act(() => {
      useChatStore.setState({
        executeGatewayAgent: executeGatewayAgentSpy,
        isGatewayModeEnabled: () => true,
      });
    });

    await act(async () => {
      await result.current.sendMessage({
        context: { agentId: TEST_IDS.SESSION_ID, threadId: null, topicId: null },
        message: 'review the page',
      });
    });

    expect(executeGatewayAgentSpy.mock.calls[0][0].selectedSkillIds).toBeUndefined();
  });
});
