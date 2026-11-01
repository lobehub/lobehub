import type * as LobechatConstModule from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiChatService } from '@/services/aiChat';
import { getPendingTopicRepos, setPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { type ProjectDirectory, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
import { createMockAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

const mockConstEnv = vi.hoisted(() => ({ isDesktop: false }));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();
  return {
    ...actual,
    get isDesktop() {
      return mockConstEnv.isDesktop;
    },
  };
});

vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: { getGeneralAccess: vi.fn() },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } },
  },
}));

const DEVICE_ID = 'device-85';
const PROJECT_PATH = '/repo/project';
const AGENT_DEFAULT_PATH = '/repo/agent-default';

const directoryRow = {
  deviceId: DEVICE_ID,
  environmentId: 'env-85',
  id: 'dir-85',
  instanceId: 'inst-85',
  path: PROJECT_PATH,
  projectId: 'prj-1',
} as ProjectDirectory;

beforeEach(() => {
  resetTestEnvironment();
  spyOnMessageService();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
  useUserStore.setState({ workspaceUserPreference: {} });
  useProjectDirectoryStore.setState({ directoriesMap: { all: [directoryRow] } });

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
  mockConstEnv.isDesktop = false;
  setPendingTopicRepos(TEST_IDS.SESSION_ID, []);
  useProjectDirectoryStore.setState({ directoriesMap: {} });
  vi.restoreAllMocks();
});

describe('sendMessage in a project directory', () => {
  // Regression: the new topic's optimistic metadata took the agent's own
  // per-device directory, and the send-time git snapshot wrote that config back
  // over the server's project binding — the composer then showed another repo's
  // branch, and the next turn was refused for a mismatched directory.
  it('seeds the new topic with the project directory, not the agent default', async () => {
    mockConstEnv.isDesktop = true;
    setupMockSelectors({
      agentConfig: {
        agencyConfig: {
          boundDeviceId: DEVICE_ID,
          executionTarget: 'device',
          workingDirByDevice: { [DEVICE_ID]: AGENT_DEFAULT_PATH },
        },
      },
    });
    const executeGatewayAgentSpy = vi.fn().mockResolvedValue({ topicId: 'tpc_new' });
    const agentId = TEST_IDS.SESSION_ID;

    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        activeTopicId: undefined,
        executeGatewayAgent: executeGatewayAgentSpy,
        isGatewayModeEnabled: () => true,
        pendingNewTopicDirectory: { agentId, projectWorkingDirectoryId: 'dir-85' },
      });
    });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, threadId: null, topicId: null },
        message: 'Start in the project',
      });
    });

    expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        optimisticTopic: expect.objectContaining({
          metadata: expect.objectContaining({
            workingDirectory: PROJECT_PATH,
            workingDirectoryConfig: { path: PROJECT_PATH },
          }),
        }),
        projectWorkingDirectoryId: 'dir-85',
      }),
    );
  });

  // A cloud repo picked in the composer before the project "+" would otherwise
  // win both metadata paths, binding the topic to one directory but starting it
  // in another.
  it('lets the staged project directory win over a pending cloud repo pick', async () => {
    mockConstEnv.isDesktop = true;
    setupMockSelectors({
      agentConfig: { agencyConfig: { boundDeviceId: DEVICE_ID, executionTarget: 'device' } },
    });
    const agentId = TEST_IDS.SESSION_ID;
    setPendingTopicRepos(agentId, ['lobehub/cloud-repo']);
    let pendingAtDispatch: string[] | undefined;
    const executeGatewayAgentSpy = vi.fn().mockImplementation(async () => {
      pendingAtDispatch = getPendingTopicRepos(agentId);
      return { topicId: 'tpc_new' };
    });

    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        activeTopicId: undefined,
        executeGatewayAgent: executeGatewayAgentSpy,
        isGatewayModeEnabled: () => true,
        pendingNewTopicDirectory: { agentId, projectWorkingDirectoryId: 'dir-85' },
      });
    });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, threadId: null, topicId: null },
        message: 'Start in the project',
      });
    });

    const params = executeGatewayAgentSpy.mock.calls[0][0];
    expect(params.projectWorkingDirectoryId).toBe('dir-85');
    expect(params.optimisticTopic.metadata).not.toHaveProperty('repos');
    expect(params.optimisticTopic.metadata).toEqual(
      expect.objectContaining({ workingDirectoryConfig: { path: PROJECT_PATH } }),
    );
    expect(pendingAtDispatch).toEqual([]);
  });

  // Regression (acceptance): a first send the server refused (device offline)
  // rolled the optimistic topic back but left the staging consumed, so the
  // blank project conversation lost its directory — on a project page the
  // composer vanished and the restored draft had nowhere to be sent.
  it('restages the project directory when a refused first send rolls back', async () => {
    mockConstEnv.isDesktop = true;
    setupMockSelectors({
      agentConfig: { agencyConfig: { boundDeviceId: DEVICE_ID, executionTarget: 'device' } },
    });
    const agentId = TEST_IDS.SESSION_ID;
    const staged = { agentId, projectWorkingDirectoryId: 'dir-85' };
    const executeGatewayAgentSpy = vi
      .fn()
      .mockRejectedValue(new Error('Device is offline or working directory is unavailable'));

    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        activeTopicId: undefined,
        executeGatewayAgent: executeGatewayAgentSpy,
        isGatewayModeEnabled: () => true,
        pendingNewTopicDirectory: staged,
      });
    });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, threadId: null, topicId: null },
        message: 'Start on an offline device',
      });
    });

    expect(executeGatewayAgentSpy).toHaveBeenCalled();
    expect(result.current.activeTopicId).toBeFalsy();
    expect(result.current.pendingNewTopicDirectory).toEqual(staged);
  });

  // `/newTopic` from a project topic creates a topic outside the project, so it
  // must not inherit the directory it was sent from.
  it('keeps a /newTopic sent from a project topic on the agent default', async () => {
    mockConstEnv.isDesktop = true;
    setupMockSelectors({
      agentConfig: {
        agencyConfig: {
          boundDeviceId: DEVICE_ID,
          executionTarget: 'device',
          workingDirByDevice: { [DEVICE_ID]: AGENT_DEFAULT_PATH },
        },
      },
    });
    const executeGatewayAgentSpy = vi.fn().mockResolvedValue({ topicId: 'tpc_new' });
    const agentId = TEST_IDS.SESSION_ID;

    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        executeGatewayAgent: executeGatewayAgentSpy,
        isGatewayModeEnabled: () => true,
        topicDetailMap: {
          tpc_bound: {
            createdAt: Date.now(),
            id: 'tpc_bound',
            projectWorkingDirectoryId: 'dir-85',
            title: 'Bound',
            updatedAt: Date.now(),
          } as any,
        },
      });
    });

    const editorData = {
      root: {
        children: [
          {
            children: [
              { actionCategory: 'command', actionType: 'newTopic', type: 'action-tag' },
              { text: ' Start fresh', type: 'text' },
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };
    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, threadId: null, topicId: 'tpc_bound' },
        editorData,
        message: 'Start fresh',
      });
    });

    const params = executeGatewayAgentSpy.mock.calls[0][0];
    expect(params.projectWorkingDirectoryId).toBeUndefined();
    expect(params.optimisticTopic.metadata).toEqual(
      expect.objectContaining({
        workingDirectory: AGENT_DEFAULT_PATH,
        workingDirectoryConfig: { path: AGENT_DEFAULT_PATH },
      }),
    );
  });
});

describe('sendMessage in a project without a directory', () => {
  // Regression (user report): a project "+" with no runnable directory created
  // an empty "untitled" topic up front. The blank draft now stages the project
  // alone, and the first send creates the topic conversation-only inside it.
  it('binds the new gateway topic to the staged project without routing to a device', async () => {
    setupMockSelectors({ agentConfig: { agencyConfig: { executionTarget: 'cloud' } } });
    const executeGatewayAgentSpy = vi.fn().mockResolvedValue({ topicId: 'tpc_new' });
    const agentId = TEST_IDS.SESSION_ID;

    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        activeTopicId: undefined,
        executeGatewayAgent: executeGatewayAgentSpy,
        isGatewayModeEnabled: () => true,
        pendingNewTopicDirectory: { agentId, projectId: 'prj-1' },
      });
    });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, threadId: null, topicId: null },
        message: 'Start in the project',
      });
    });

    const params = executeGatewayAgentSpy.mock.calls[0][0];
    expect(params.projectId).toBe('prj-1');
    expect(params.projectWorkingDirectoryId).toBeUndefined();
    const optimisticRow = Object.values(result.current.topicDataMap)
      .flatMap((data) => data.items)
      .find((topic) => topic.id === params.optimisticTopic.id);
    expect(optimisticRow?.projectId).toBe('prj-1');
    expect(optimisticRow?.projectWorkingDirectoryId).toBeUndefined();
  });

  it('creates the client-runtime topic inside the staged project', async () => {
    setupMockSelectors({ agentConfig: {} });
    const agentId = TEST_IDS.SESSION_ID;
    const sendMessageInServerSpy = vi
      .spyOn(aiChatService, 'sendMessageInServer')
      .mockRejectedValue(new Error('stop after the request is built'));

    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        activeTopicId: undefined,
        isGatewayModeEnabled: () => false,
        pendingNewTopicDirectory: { agentId, projectId: 'prj-1' },
      });
    });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, threadId: null, topicId: null },
        message: 'Start in the project',
      });
    });

    expect(sendMessageInServerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ newTopic: expect.objectContaining({ projectId: 'prj-1' }) }),
      expect.any(AbortController),
    );
    // The refused first send hands the project back to the blank draft.
    expect(result.current.pendingNewTopicDirectory).toEqual({ agentId, projectId: 'prj-1' });
  });
});
