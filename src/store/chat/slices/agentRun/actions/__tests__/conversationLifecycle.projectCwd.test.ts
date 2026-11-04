import type * as LobechatConstModule from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiChatService } from '@/services/aiChat';
import { deviceService } from '@/services/device';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
import { getPendingTopicRepos, setPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { useElectronStore } from '@/store/electron';
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

describe('sendMessage continuing a source topic', () => {
  const OTHER_DEVICE_ID = 'device-other';
  const SOURCE_PATH = '/repo/source';
  const forwardContext = (agentId: string) => ({
    agentId,
    isNew: true,
    isolatedTopic: true,
    scope: 'main' as const,
  });
  const statPath = (exists: boolean | null) =>
    vi
      .spyOn(deviceService, 'statPath')
      .mockResolvedValue(exists === null ? null : ({ exists, isDirectory: exists } as any));
  beforeEach(() => {
    statPath(true);
  });
  const sendForward = async (sourceTopic: any) => {
    const executeGatewayAgentSpy = vi.fn().mockResolvedValue({ topicId: 'tpc_new' });
    const agentId = TEST_IDS.SESSION_ID;
    act(() => {
      useChatStore.setState({
        executeGatewayAgent: executeGatewayAgentSpy,
        isGatewayModeEnabled: () => true,
      });
    });
    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.sendMessage({
        context: forwardContext(agentId),
        message: 'Continue the handoff',
        sourceTopic,
      });
    });
    return executeGatewayAgentSpy.mock.calls[0][0];
  };

  // Regression (user report): a forwarded task started in the receiving
  // agent's default directory instead of the one the source topic ran in.
  it('starts a forwarded topic in the source project directory', async () => {
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

    const params = await sendForward({
      metadata: { boundDeviceId: DEVICE_ID, workingDirectory: PROJECT_PATH },
      projectId: 'prj-1',
      projectWorkingDirectoryId: 'dir-85',
    });

    expect(params.projectWorkingDirectoryId).toBe('dir-85');
    expect(params.newTopicMetadata).toEqual(
      expect.objectContaining({ workingDirectory: PROJECT_PATH }),
    );
  });

  it('carries the source bare directory to the server on the same machine', async () => {
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

    const params = await sendForward({
      metadata: {
        boundDeviceId: DEVICE_ID,
        heteroSessionId: 'source-cli-session',
        workingDirectory: SOURCE_PATH,
        workingDirectoryConfig: { path: SOURCE_PATH },
      },
    });

    expect(params.projectWorkingDirectoryId).toBeUndefined();
    expect(params.newTopicMetadata).toEqual({
      boundDeviceId: DEVICE_ID,
      workingDirectory: SOURCE_PATH,
      workingDirectoryConfig: { path: SOURCE_PATH },
    });
  });

  // The path only exists on the machine it was recorded on.
  // A legacy topic never recorded its machine: the same absolute path on the
  // receiving machine may be an unrelated checkout, so it is not inherited.
  it.each([
    ['on another machine', { boundDeviceId: OTHER_DEVICE_ID, workingDirectory: SOURCE_PATH }],
    ['on an unknown machine', { workingDirectory: SOURCE_PATH }],
  ])('keeps the agent default when the source directory is %s', async (_, metadata) => {
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

    const params = await sendForward({ metadata });

    expect(params.newTopicMetadata).toEqual(
      expect.objectContaining({ workingDirectory: AGENT_DEFAULT_PATH }),
    );
  });

  // `auto` resolves this desktop client-side, but the server may route the run
  // to another online device; a machine-specific path cannot be inherited until
  // the run's machine is actually known.
  it('keeps the agent default for an auto-routed agent', async () => {
    mockConstEnv.isDesktop = true;
    vi.spyOn(useElectronStore.getState(), 'resolveGatewayDeviceId').mockResolvedValue(DEVICE_ID);
    setupMockSelectors({
      agentConfig: {
        agencyConfig: {
          executionTarget: 'auto',
          workingDirByDevice: { [DEVICE_ID]: AGENT_DEFAULT_PATH },
        },
      },
    });

    const params = await sendForward({
      metadata: { boundDeviceId: DEVICE_ID, workingDirectory: SOURCE_PATH },
    });

    expect(params.newTopicMetadata?.workingDirectory).not.toBe(SOURCE_PATH);
  });

  // A source directory the receiving agent cannot resolve (deleted, gateway
  // off) must not fail the handoff: it continues in the source's bare cwd.
  it('falls back to the source cwd when its project directory cannot be resolved', async () => {
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
    useProjectDirectoryStore.setState({ directoriesMap: {} });
    vi.spyOn(projectWorkingDirectoryService, 'resolve').mockRejectedValue(
      new Error('Directory not found'),
    );

    const params = await sendForward({
      metadata: { boundDeviceId: DEVICE_ID, workingDirectory: PROJECT_PATH },
      projectWorkingDirectoryId: 'dir-gone',
    });

    expect(params.projectWorkingDirectoryId).toBeUndefined();
    expect(params.newTopicMetadata).toEqual(
      expect.objectContaining({ workingDirectory: PROJECT_PATH }),
    );
  });
  // The source directory may have been deleted since it ran; the receiving
  // agent then takes the handoff in its own default instead of a run that can
  // only fail with "working directory not found".
  const deviceAgent = () =>
    setupMockSelectors({
      agentConfig: {
        agencyConfig: {
          boundDeviceId: DEVICE_ID,
          executionTarget: 'device',
          workingDirByDevice: { [DEVICE_ID]: AGENT_DEFAULT_PATH },
        },
      },
    });

  it('falls back to the agent default when the source cwd no longer exists', async () => {
    mockConstEnv.isDesktop = true;
    deviceAgent();
    statPath(false);

    const params = await sendForward({
      metadata: { boundDeviceId: DEVICE_ID, workingDirectory: SOURCE_PATH },
    });

    expect(deviceService.statPath).toHaveBeenCalledWith(DEVICE_ID, SOURCE_PATH);
    expect(params.newTopicMetadata).toEqual(
      expect.objectContaining({ workingDirectory: AGENT_DEFAULT_PATH }),
    );
  });

  it('falls back to the agent default when the source project directory no longer exists', async () => {
    mockConstEnv.isDesktop = true;
    deviceAgent();
    statPath(false);

    const params = await sendForward({
      metadata: { boundDeviceId: DEVICE_ID, workingDirectory: PROJECT_PATH },
      projectWorkingDirectoryId: 'dir-85',
    });

    expect(params.projectWorkingDirectoryId).toBeUndefined();
    expect(params.newTopicMetadata).toEqual(
      expect.objectContaining({ workingDirectory: AGENT_DEFAULT_PATH }),
    );
  });

  // An unreachable device cannot say the directory is gone; the spawn-time
  // check stays the authority rather than silently moving the task elsewhere.
  it('keeps the source cwd when its existence cannot be verified', async () => {
    mockConstEnv.isDesktop = true;
    deviceAgent();
    statPath(null);

    const params = await sendForward({
      metadata: { boundDeviceId: DEVICE_ID, workingDirectory: SOURCE_PATH },
    });

    expect(params.newTopicMetadata).toEqual(
      expect.objectContaining({ workingDirectory: SOURCE_PATH }),
    );
  });
});
