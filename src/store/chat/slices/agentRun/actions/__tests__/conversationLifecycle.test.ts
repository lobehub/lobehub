import type * as LobechatConstModule from '@lobechat/const';
import { act, renderHook, waitFor } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { t } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraft, removeDraft } from '@/features/ChatInput/draftStorage';
import { agentService } from '@/services/agent';
import { aiAgentService } from '@/services/aiAgent';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import * as skillPreload from '@/services/chat/mecha/skillPreload';
import { messageService } from '@/services/message';
import * as agentGroupStore from '@/store/agentGroup';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/slices/aiModel/selectors';
import { setPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import type {
  VoiceMessageSend,
  VoiceMessageSendOptions,
} from '@/store/chat/slices/voiceMessage/action';
import { LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useDeviceStore } from '@/store/device';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { type ProjectDirectory, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import { getSessionStoreState } from '@/store/session';
import * as toolStoreModule from '@/store/tool';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/pageAgentRuntime';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
import type * as DirectMentionExecutorModule from '../dispatch/directMentionExecutor';
import { createMockAgentConfig, createMockMessage, TEST_CONTENT, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

const executeHeterogeneousAgentMock = vi.hoisted(() => vi.fn());
const mockConstEnv = vi.hoisted(() => ({ isDesktop: false }));
const mockLocalFileService = vi.hoisted(() => ({
  listLocalFiles: vi.fn(),
  readLocalFile: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();
  return {
    ...actual,
    get isDesktop() {
      return mockConstEnv.isDesktop;
    },
  };
});

vi.mock('../transports/hetero/heterogeneousAgentExecutor', () => ({
  executeHeterogeneousAgent: (...args: any[]) => executeHeterogeneousAgentMock(...args),
}));

// Tests whose subject is the persistence request of the direct @agent route
// stub the mentioned agent's run, so its message writes don't race the
// assertions; the rest exercise the real executor.
const directMentionRunStub = vi.hoisted(() => ({ enabled: false }));
vi.mock('../dispatch/directMentionExecutor', async (importOriginal) => {
  const actual = await importOriginal<typeof DirectMentionExecutorModule>();
  return {
    ...actual,
    executeDirectMention: (...args: Parameters<typeof actual.executeDirectMention>) =>
      directMentionRunStub.enabled ? Promise.resolve() : actual.executeDirectMention(...args),
  };
});

const getGeneralAccessMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/resourcePermission', () => ({
  resourcePermissionService: { getGeneralAccess: getGeneralAccessMock },
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: mockLocalFileService,
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
  const sessionStore = getSessionStoreState();
  vi.spyOn(sessionStore, 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
  useUserStore.setState({ workspaceUserPreference: {} });
  useFileStore.setState({ chatContextSelectionsByContext: {} });

  act(() => {
    useChatStore.setState({
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
      mainInputEditor: null,
    });
  });
});

afterEach(() => {
  executeHeterogeneousAgentMock.mockReset();
  directMentionRunStub.enabled = false;
  mockConstEnv.isDesktop = false;
  setPendingTopicRepos(TEST_IDS.SESSION_ID, []);
  // Zustand state and the window-backed agent context survive `restoreAllMocks`,
  // so a cwd test that seeds a device (or a desktop path) would otherwise leak
  // a working directory into every later send in this file.
  useDeviceStore.setState({ deviceListMap: {} });
  delete window.__LOBE_GLOBAL_AGENT_CONTEXT__;
  vi.restoreAllMocks();
});

// Helper to create context for testing
const createTestContext = (agentId: string = TEST_IDS.SESSION_ID) => ({
  agentId,
  topicId: null,
  threadId: null,
});

/**
 * Stub the gateway transport at the store boundary. The default implementation
 * mirrors the real contract the lifecycle relies on: it completes the parent
 * `sendMessage` operation once phase-1 init is done and echoes the client ids.
 */
const mockGatewayAgent = (impl?: (params: any) => Promise<any>) => {
  const executeGatewayAgent = vi.fn(
    impl ??
      (async (params: any) => {
        useChatStore.getState().completeOperation(params.parentOperationId);
        return {
          assistantMessageId: params.clientIds.assistantMessageId,
          operationId: 'gateway-op',
          topicId: params.clientIds.topicId ?? params.context.topicId ?? undefined,
          userMessageId: params.clientIds.userMessageId,
        };
      }),
  );
  act(() => {
    useChatStore.setState({
      executeGatewayAgent,
      isGatewayModeEnabled: () => true,
      // A resolved topic fires the title hook; keep the real LLM call out of it
      // unless the test installed its own spy.
      ...(!vi.isMockFunction(useChatStore.getState().summaryTopicTitle) && {
        summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });
  return executeGatewayAgent;
};

const DIRECT_MENTION_AGENT_ID = 'agent-direct-target';

/**
 * A single leading `@agent` mention takes the direct-mention route — the only
 * non-hetero path that still persists the turn through `sendMessageInServer`.
 */
const directMentionEditorData = (text: string, extraNodes: any[] = []) =>
  ({
    root: {
      children: [
        {
          children: [
            {
              label: 'Agent B',
              metadata: { id: DIRECT_MENTION_AGENT_ID, type: 'agent' },
              type: 'mention',
            },
            { text, type: 'text' },
            ...extraNodes,
          ],
          type: 'paragraph',
        },
      ],
      type: 'root',
    },
  }) as any;

/** Skip the mentioned agent's run; the test only covers the persisted turn. */
const stubDirectMentionRun = () => {
  directMentionRunStub.enabled = true;
};

describe('ConversationLifecycle actions', () => {
  describe('sendMessage', () => {
    describe('validation', () => {
      it('should not send when sessionId is empty', async () => {
        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: { agentId: '', topicId: null, threadId: null },
          });
        });

        expect(executeGatewayAgent).not.toHaveBeenCalled();
      });

      it('should not send when message is empty and no files are provided', async () => {
        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.EMPTY,
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgent).not.toHaveBeenCalled();
      });

      it('should not send when message is empty with empty files array', async () => {
        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.EMPTY,
            files: [],
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgent).not.toHaveBeenCalled();
      });
    });

    describe('message creation', () => {
      // The resolved parent only reaches the request on the persistence path,
      // which the direct @agent route still takes (gateway lets the server pick).
      it('continues from the active conversational tail after a recovered task callback', async () => {
        const { result } = renderHook(() => useChatStore());
        stubDirectMentionRun();
        const agentId = TEST_IDS.SESSION_ID;
        const topicId = TEST_IDS.TOPIC_ID;
        const activeAssistant = createMockMessage({
          id: 'active-assistant',
          role: 'assistant',
          topicId,
        });
        const recoveredCallback = createMockMessage({
          id: 'recovered-task-callback',
          parentId: 'tool-use-shell',
          role: 'taskCallback',
          topicId,
        });
        const key = messageMapKey({ agentId, topicId });
        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            messagesMap: { [key]: [activeAssistant, recoveredCallback] },
          });
        });
        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [
              createMockMessage({
                id: TEST_IDS.USER_MESSAGE_ID,
                parentId: activeAssistant.id,
                role: 'user',
                topicId,
              }),
              createMockMessage({
                id: TEST_IDS.ASSISTANT_MESSAGE_ID,
                parentId: TEST_IDS.USER_MESSAGE_ID,
                role: 'assistant',
                topicId,
              }),
            ],
            topicId,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, threadId: null, topicId },
            editorData: directMentionEditorData(` ${TEST_CONTENT.USER_MESSAGE}`),
            message: TEST_CONTENT.USER_MESSAGE,
            messages: [activeAssistant, recoveredCallback],
          });
        });

        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            newUserMessage: expect.objectContaining({ parentId: activeAssistant.id }),
          }),
          expect.any(AbortController),
        );
      });

      it('should render pending compressedGroup immediately for /compact', async () => {
        const { result } = renderHook(() => useChatStore());
        const topicId = TEST_IDS.TOPIC_ID;
        const agentId = TEST_IDS.SESSION_ID;
        const key = messageMapKey({ agentId, topicId });
        const existingMessages = [
          createMockMessage({ id: 'user-1', role: 'user', topicId }),
          createMockMessage({ id: 'assistant-1', role: 'assistant', topicId }),
        ];

        await act(async () => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [key]: existingMessages },
            messagesMap: { [key]: existingMessages },
          });
        });

        const createCompressionGroupSpy = vi
          .spyOn(messageService, 'createCompressionGroup')
          .mockResolvedValue({
            messageGroupId: 'group-1',
            messages: [
              {
                id: 'group-1',
                content: '...',
                role: 'compressedGroup',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              } as any,
            ],
            messagesToSummarize: existingMessages,
          });
        vi.spyOn(chatService, 'fetchPresetTaskResult').mockResolvedValue(undefined);
        vi.spyOn(messageService, 'finalizeCompression').mockResolvedValue({
          messages: [
            {
              id: 'group-1',
              content: 'summary',
              role: 'compressedGroup',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            } as any,
          ],
        });

        const optimisticCreateTmpMessageSpy = vi.spyOn(
          result.current,
          'optimisticCreateTmpMessage',
        );
        const internalDispatchMessageSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, topicId, threadId: null },
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        actionCategory: 'command',
                        actionLabel: 'Compact context',
                        actionType: 'compact',
                        type: 'action-tag',
                      },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            message: '',
          });
        });

        expect(optimisticCreateTmpMessageSpy).not.toHaveBeenCalled();
        expect(internalDispatchMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.stringMatching(/^tmp_compress_/),
            type: 'createMessage',
            value: expect.objectContaining({
              compressedMessages: [],
              content: '...',
              role: 'compressedGroup',
            }),
          }),
          expect.any(Object),
        );
        expect(createCompressionGroupSpy).toHaveBeenCalledWith({
          agentId,
          messageIds: ['user-1', 'assistant-1'],
          topicId,
        });
      });

      it('should not process AI when onlyAddUserMessage is true', async () => {
        const { result } = renderHook(() => useChatStore());
        const onMessageAccepted = vi.fn();
        const executeGatewayAgent = mockGatewayAgent();
        const onMessagePersisted = vi.fn();

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [],
          topics: [],
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            onlyAddUserMessage: true,
            onMessageAccepted,
            onMessagePersisted,
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgent).not.toHaveBeenCalled();
        expect(onMessageAccepted).toHaveBeenCalledOnce();
        expect(onMessagePersisted).toHaveBeenCalledOnce();
      });

      it('should restore the pre-send editor snapshot when server send fails', async () => {
        const { result } = renderHook(() => useChatStore());
        const onMessagePersisted = vi.fn();
        const inputEditorState = {
          root: {
            children: [
              {
                children: [{ text: 'Restored rich text', type: 'text', version: 1 }],
                type: 'paragraph',
                version: 1,
              },
            ],
            type: 'root',
            version: 1,
          },
        };
        const clearedEditorState = {
          root: { children: [], type: 'root', version: 1 },
        };
        const setDocument = vi.fn();
        const setJSONState = vi.fn();

        vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(
          new TRPCClientError('restore failed'),
        );

        act(() => {
          useChatStore.setState({
            mainInputEditor: {
              getJSONState: vi.fn().mockReturnValue(clearedEditorState),
              setDocument,
              setJSONState,
            } as any,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: inputEditorState as any,
            message: 'Restored rich text',
            onMessagePersisted,
          });
        });

        const sendMessageOperation = Object.values(result.current.operations).find(
          (operation) => operation.type === 'sendMessage',
        );

        expect(sendMessageOperation?.metadata.inputEditorTempState).toEqual(inputEditorState);
        expect(setJSONState).toHaveBeenCalledWith(inputEditorState);
        expect(setDocument).not.toHaveBeenCalled();
        expect(onMessagePersisted).not.toHaveBeenCalled();
      });

      it('should not restore an editor snapshot when a separate voice send fails', async () => {
        const { result } = renderHook(() => useChatStore());
        const getJSONState = vi.fn().mockReturnValue({ stale: 'draft' });
        const setDocument = vi.fn();
        const setJSONState = vi.fn();

        vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(
          new TRPCClientError('voice persistence failed'),
        );

        act(() => {
          useChatStore.setState({
            mainInputEditor: {
              getJSONState,
              setDocument,
              setJSONState,
            } as any,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            files: [{ id: 'voice-file' } as any],
            message: '',
            preserveComposer: true,
          });
        });

        const sendMessageOperation = Object.values(result.current.operations).find(
          (operation) => operation.type === 'sendMessage',
        );

        expect(sendMessageOperation?.metadata.inputEditorTempState).toBeUndefined();
        expect(getJSONState).not.toHaveBeenCalled();
        expect(setJSONState).not.toHaveBeenCalled();
        expect(setDocument).not.toHaveBeenCalled();
      });

      // Regression: the send adopts its minted topic (clearing the staged
      // directory) before the gateway transport runs, so the directory a
      // project group "+" staged never reached the server and the topic was
      // born outside the project.
      it('carries the staged project directory into the gateway send of a new topic', async () => {
        const { projectWorkingDirectoryService } =
          await import('@/services/projectWorkingDirectory');
        vi.spyOn(projectWorkingDirectoryService, 'resolve').mockResolvedValue({
          data: { deviceId: 'device-85', id: 'dir-85', projectId: 'prj-1' },
        } as any);
        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({ topicId: 'tpc_new' });

        act(() => {
          useChatStore.setState({
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
            pendingNewTopicDirectory: {
              agentId: TEST_IDS.SESSION_ID,
              projectWorkingDirectoryId: 'dir-85',
            },
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            message: 'Start in the directory',
          });
        });

        expect(projectWorkingDirectoryService.resolve).toHaveBeenCalledWith('dir-85');
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({ projectWorkingDirectoryId: 'dir-85' }),
        );
      });

      // Regression: every project send awaited `projectWorkingDirectory.resolve`
      // before the optimistic pair was dispatched, so the message only appeared
      // after a network round trip. The directory replica already holds the row.
      describe('project directory read from the local replica', () => {
        const directoryRow = {
          deviceId: 'device-85',
          environmentId: 'env-85',
          id: 'dir-85',
          instanceId: 'inst-85',
          projectId: 'prj-1',
        } as ProjectDirectory;

        afterEach(() => {
          useProjectDirectoryStore.setState({ directoriesMap: {} });
        });

        const sendWithPendingGateway = async (context: ReturnType<typeof createTestContext>) => {
          const { projectWorkingDirectoryService } =
            await import('@/services/projectWorkingDirectory');
          const resolveSpy = vi.spyOn(projectWorkingDirectoryService, 'resolve');
          let releaseGateway!: () => void;
          const executeGatewayAgentSpy = vi.fn(
            () =>
              new Promise((resolve) => {
                releaseGateway = () => resolve({ topicId: 'tpc_new' });
              }),
          );
          useProjectDirectoryStore.setState({ directoriesMap: { all: [directoryRow] } });
          act(() => {
            useChatStore.setState({
              executeGatewayAgent: executeGatewayAgentSpy as any,
              isGatewayModeEnabled: () => true,
            });
          });

          const { result } = renderHook(() => useChatStore());
          let sendPromise!: Promise<unknown>;
          await act(async () => {
            sendPromise = result.current.sendMessage({ context, message: 'Project send' });
          });
          await waitFor(() => expect(executeGatewayAgentSpy).toHaveBeenCalled());

          const optimisticUser = Object.values(useChatStore.getState().dbMessagesMap)
            .flat()
            .find((message) => message.role === 'user' && message.content === 'Project send');

          await act(async () => {
            releaseGateway();
            await sendPromise;
          });

          return { executeGatewayAgentSpy, optimisticUser, resolveSpy };
        };

        it('dispatches a staged-directory send without awaiting resolve', async () => {
          act(() => {
            useChatStore.setState({
              pendingNewTopicDirectory: {
                agentId: TEST_IDS.SESSION_ID,
                projectWorkingDirectoryId: 'dir-85',
              },
            });
          });

          const { executeGatewayAgentSpy, optimisticUser, resolveSpy } =
            await sendWithPendingGateway(createTestContext());

          expect(resolveSpy).not.toHaveBeenCalled();
          expect(optimisticUser).toBeDefined();
          expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
            expect.objectContaining({ projectWorkingDirectoryId: 'dir-85' }),
          );
        });

        it('dispatches a send in a directory-bound topic without awaiting resolve', async () => {
          act(() => {
            useChatStore.setState({
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

          const { executeGatewayAgentSpy, optimisticUser, resolveSpy } =
            await sendWithPendingGateway({ ...createTestContext(), topicId: 'tpc_bound' });

          expect(resolveSpy).not.toHaveBeenCalled();
          expect(optimisticUser).toBeDefined();
          expect(executeGatewayAgentSpy).toHaveBeenCalled();
        });
      });

      it('should restore the pre-send editor snapshot when a gateway send fails', async () => {
        // Regression: the composer is cleared the instant Enter is pressed, and
        // only the client-runtime branch put the text back. The gateway branch
        // just logged, failed the op and deleted the optimistic pair — so a
        // server-side start refusal (e.g. `Topic <id> remained busy while
        // starting operation ...`, thrown by the reservation gate before the
        // user message is ever persisted) made the message vanish with no trace
        // and no way to recover what was typed.
        const { result } = renderHook(() => useChatStore());
        const inputEditorState = {
          root: {
            children: [
              {
                children: [{ text: 'Swallowed by gateway', type: 'text', version: 1 }],
                type: 'paragraph',
                version: 1,
              },
            ],
            type: 'root',
            version: 1,
          },
        };
        const setDocument = vi.fn();
        const setJSONState = vi.fn();
        const executeGatewayAgentSpy = vi
          .fn()
          .mockRejectedValue(
            new TRPCClientError('Topic tpc_test remained busy while starting operation'),
          );

        act(() => {
          useChatStore.setState({
            isGatewayModeEnabled: () => true,
            executeGatewayAgent: executeGatewayAgentSpy,
            mainInputEditor: {
              getJSONState: vi.fn().mockReturnValue({ root: { children: [], type: 'root' } }),
              setDocument,
              setJSONState,
            } as any,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: inputEditorState as any,
            message: 'Swallowed by gateway',
          });
        });

        const sendMessageOperation = Object.values(result.current.operations).find(
          (operation) => operation.type === 'sendMessage',
        );

        // Prove the gateway branch actually ran and failed — otherwise a silent
        // early bail would satisfy the restore assertions below by accident.
        expect(executeGatewayAgentSpy).toHaveBeenCalled();
        expect(sendMessageOperation?.status).toBe('failed');

        expect(setJSONState).toHaveBeenCalledWith(inputEditorState);
        expect(sendMessageOperation?.metadata.inputSendErrorMsg).toBeTruthy();
      });

      it('should fire onPreflightFailure when a gateway send is refused before acceptance', async () => {
        // Regression: the composer is cleared (text, uploads, context
        // selections) the instant Enter is pressed. A gateway send the server
        // refuses before persisting anything — e.g. a project-directory topic
        // whose bound device is offline, rejected in turn setup — restored
        // only the editor text via `restoreComposerAfterFailedSend`, so the
        // cleared attachments and selections vanished. The lifecycle must
        // also fire `onPreflightFailure`, the callback the composer uses to
        // restore them.
        const { result } = renderHook(() => useChatStore());
        const onPreflightFailure = vi.fn();
        const executeGatewayAgentSpy = vi
          .fn()
          .mockRejectedValue(
            new TRPCClientError('Device is offline or working directory is unavailable'),
          );

        act(() => {
          useChatStore.setState({
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
            mainInputEditor: {
              getJSONState: vi.fn().mockReturnValue({ root: { children: [], type: 'root' } }),
              setDocument: vi.fn(),
              setJSONState: vi.fn(),
            } as any,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            message: 'Send to an offline device',
            onPreflightFailure,
          });
        });

        // Prove the gateway branch actually ran and failed — otherwise a
        // silent early bail would satisfy the assertion below by accident.
        expect(executeGatewayAgentSpy).toHaveBeenCalled();
        expect(onPreflightFailure).toHaveBeenCalledOnce();
      });

      it.each(['unchanged', 'edited', 'cleared'] as const)(
        'preserves the %s live draft when a cancelled first send rolls back asynchronously',
        async (change) => {
          const context = createTestContext();
          const draftKey = messageMapKey(context);
          const snapshot = {
            root: { children: [{ text: 'Cancelled first message' }], type: 'root' },
          };
          const latestDraft = {
            root: {
              children:
                change === 'cleared' ? [] : [{ text: 'Cancelled first message with edits' }],
              type: 'root',
            },
          };
          let editorState = snapshot;
          const editor = {
            getJSONState: vi.fn(() => editorState),
            setJSONState: vi.fn((state) => {
              editorState = state;
            }),
          };
          removeDraft(draftKey);
          const executeGatewayAgent = vi.fn().mockImplementation(async (params) => {
            const store = useChatStore.getState();
            store.cancelOperation(params.parentOperationId);
            store.cancelSendMessageInServer(params.messageContext, editor as any);
            expect(editorState).toEqual(snapshot);
            // User edits after restoration, before the aborted request unwinds.
            await Promise.resolve();
            if (change !== 'unchanged') editorState = latestDraft;
            throw new DOMException('Stopped before dispatch', 'AbortError');
          });
          useChatStore.setState({ executeGatewayAgent, isGatewayModeEnabled: () => true });

          await useChatStore.getState().sendMessage({
            context,
            editorData: snapshot as any,
            inputEditor: editor as any,
            message: 'Cancelled first message',
          });

          expect(executeGatewayAgent).toHaveBeenCalledOnce();
          expect(getDraft(draftKey)).toEqual(change === 'unchanged' ? snapshot : latestDraft);
          removeDraft(draftKey);
        },
      );

      it('does not restore an accepted gateway message when stopped during setup', async () => {
        const context = { ...createTestContext(), topicId: TEST_IDS.TOPIC_ID };
        const setJSONState = vi.fn();
        const editor = {
          getJSONState: vi.fn().mockReturnValue({ content: 'already sent' }),
          setDocument: vi.fn(),
          setJSONState,
        };
        const executeGatewayAgent = vi.fn().mockImplementation(async (params) => {
          params.onMessageAccepted();
          useChatStore.getState().cancelSendMessageInServer(context, editor as any);
          throw new DOMException('Stopped', 'AbortError');
        });
        useChatStore.setState({
          executeGatewayAgent,
          isGatewayModeEnabled: () => true,
          mainInputEditor: editor as any,
        });

        await useChatStore.getState().sendMessage({
          context,
          editorData: { content: 'already sent' } as any,
          message: 'already sent',
        });

        expect(executeGatewayAgent).toHaveBeenCalledOnce();
        expect(setJSONState).not.toHaveBeenCalled();
      });

      it('should not restore the composer when gateway setup fails after message acceptance', async () => {
        const { result } = renderHook(() => useChatStore());
        const onPreflightFailure = vi.fn();
        const setDocument = vi.fn();
        const setJSONState = vi.fn();
        const executeGatewayAgentSpy = vi.fn().mockImplementation(async (params) => {
          params.onMessageAccepted();
          throw new Error('gateway client initialization failed');
        });

        act(() => {
          useChatStore.setState({
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
            mainInputEditor: {
              getJSONState: vi.fn().mockReturnValue({ root: { children: [], type: 'root' } }),
              setDocument,
              setJSONState,
            } as any,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            message: 'Already persisted',
            onPreflightFailure,
          });
        });

        const sendMessageOperation = Object.values(result.current.operations).find(
          (operation) => operation.type === 'sendMessage',
        );
        expect(executeGatewayAgentSpy).toHaveBeenCalledOnce();
        expect(setDocument).not.toHaveBeenCalled();
        expect(setJSONState).not.toHaveBeenCalled();
        // The message was accepted, so nothing the composer cleared is
        // orphaned — restoring it would duplicate the persisted turn's data.
        expect(onPreflightFailure).not.toHaveBeenCalled();
        expect(sendMessageOperation?.metadata.inputSendErrorMsg).toBeUndefined();
      });

      it('does not refill the global composer when a send names no editor of its own', async () => {
        // Regression: an embedded reply (a task run's inline follow-up) passes
        // `inputEditor: null` to say "no composer here". The lifecycle used to
        // treat that null as "unset" and fall back to ChatStore's global editor,
        // writing the failed message into a surface the send does not own.
        const { result } = renderHook(() => useChatStore());
        const setDocument = vi.fn();
        const setJSONState = vi.fn();
        const executeGatewayAgentSpy = vi
          .fn()
          .mockRejectedValue(
            new TRPCClientError('Topic tpc_test remained busy while starting operation'),
          );

        act(() => {
          useChatStore.setState({
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
            mainInputEditor: {
              getJSONState: vi.fn().mockReturnValue({ root: { children: [], type: 'root' } }),
              setDocument,
              setJSONState,
            } as any,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            inputEditor: null,
            message: 'Typed into an inline reply',
          });
        });

        const sendMessageOperation = Object.values(result.current.operations).find(
          (operation) => operation.type === 'sendMessage',
        );
        // Prove the gateway branch ran and failed before asserting the global
        // editor was left untouched.
        expect(executeGatewayAgentSpy).toHaveBeenCalled();
        expect(sendMessageOperation?.status).toBe('failed');
        expect(setDocument).not.toHaveBeenCalled();
        expect(setJSONState).not.toHaveBeenCalled();
      });

      it('should send a snapshot of the tracked server runs with a gateway send', async () => {
        const context = { ...createTestContext(), topicId: TEST_IDS.TOPIC_ID };
        const contextKey = messageMapKey(context);
        const executeGatewayAgent = vi.fn().mockResolvedValue({ operationId: 'srv-new' });
        useChatStore.setState({
          executeGatewayAgent,
          isGatewayModeEnabled: () => true,
          operations: {
            'op-finished-output': {
              childOperationIds: [],
              context,
              id: 'op-finished-output',
              metadata: { serverOperationId: 'srv-live', visibleLoadingDone: true },
              status: 'running',
              type: 'execServerAgentRuntime',
            },
            'op-not-started': {
              childOperationIds: [],
              context,
              id: 'op-not-started',
              metadata: { isAborting: true },
              status: 'running',
              type: 'execServerAgentRuntime',
            },
          } as any,
          operationsByContext: { [contextKey]: ['op-finished-output', 'op-not-started'] },
        });

        await useChatStore.getState().sendMessage({ context, message: 'next turn' });

        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            // Only runs that reached the server are useful to diagnose.
            clientOperations: [
              {
                isAborting: undefined,
                operationId: 'srv-live',
                status: 'running',
                visibleLoadingDone: true,
              },
            ],
          }),
        );
      });

      it('should restore the pre-send editor snapshot when a hetero send fails', async () => {
        // Same silent-discard shape as the gateway branch above: persistence
        // throws, the temp rows are cleaned up, and the typed text is gone.
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const { result } = renderHook(() => useChatStore());
        const inputEditorState = {
          root: {
            children: [
              {
                children: [{ text: 'Swallowed by hetero', type: 'text', version: 1 }],
                type: 'paragraph',
                version: 1,
              },
            ],
            type: 'root',
            version: 1,
          },
        };
        const setDocument = vi.fn();
        const setJSONState = vi.fn();
        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockRejectedValue(
            new TRPCClientError('Topic tpc_test remained busy while starting operation'),
          );

        act(() => {
          useChatStore.setState({
            mainInputEditor: {
              getJSONState: vi.fn().mockReturnValue({ root: { children: [], type: 'root' } }),
              setDocument,
              setJSONState,
            } as any,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: inputEditorState as any,
            message: 'Swallowed by hetero',
          });
        });

        const sendMessageOperation = Object.values(result.current.operations).find(
          (operation) => operation.type === 'sendMessage',
        );

        // Prove the hetero persistence branch actually ran and failed.
        expect(sendMessageInServerSpy).toHaveBeenCalled();
        expect(sendMessageOperation?.status).toBe('failed');

        expect(setJSONState).toHaveBeenCalledWith(inputEditorState);
        expect(sendMessageOperation?.metadata.inputSendErrorMsg).toBeTruthy();
      });

      it('should move and adopt a first-turn voice row into the minted topic', async () => {
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            activeAgentId: TEST_IDS.SESSION_ID,
            activeTopicId: undefined,
          });
        });

        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice-preview');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockResolvedValue({
          id: 'uploaded-audio',
          url: 'https://example.com/voice.webm',
        });

        let resolveGateway!: () => void;
        const executeGatewayAgent = mockGatewayAgent(
          (params: any) =>
            new Promise<any>((resolve) => {
              resolveGateway = () => {
                params.onMessageAccepted?.();
                useChatStore.getState().completeOperation(params.parentOperationId);
                resolve({
                  assistantMessageId: params.clientIds.assistantMessageId,
                  operationId: 'gateway-op-voice',
                  topicId: params.clientIds.topicId,
                  userMessageId: params.clientIds.userMessageId,
                });
              };
            }),
        );

        let optimisticUserMessageId!: string;
        act(() => {
          optimisticUserMessageId = result.current.sendVoiceMessage({
            canSend: () => true,
            context,
            recording: {
              codec: 'opus',
              durationMs: 1200,
              file: new File(['voice'], 'voice.webm', { type: 'audio/webm' }),
              mimeType: 'audio/webm',
              waveform: [0.2, 0.8, 0.3],
            },
            send: (file, options) =>
              new Promise<void>((resolve, reject) => {
                let accepted = false;
                void result.current
                  .sendMessage({
                    context: options.context,
                    files: [file],
                    message: '',
                    onMessageAccepted: () => {
                      accepted = true;
                      resolve();
                    },
                    optimisticUserMessageId: options.messageId,
                    preserveComposer: true,
                    signal: options.signal,
                  })
                  .then(() => {
                    if (!accepted) reject(new Error('Voice message was not accepted'));
                  }, reject);
              }),
          })!;
        });

        await waitFor(() => expect(executeGatewayAgent).toHaveBeenCalledOnce());

        const midState = useChatStore.getState();
        const mintedTopicId = midState.activeTopicId!;
        const mintedContextKey = messageMapKey({ ...context, topicId: mintedTopicId });
        const pendingMessages = midState.dbMessagesMap[mintedContextKey];
        expect(mintedTopicId).toMatch(/^tpc_/);
        expect(optimisticUserMessageId).toMatch(/^msg_/);
        expect(midState.dbMessagesMap[contextKey] ?? []).toEqual([]);
        expect(pendingMessages.filter((message) => message.role === 'user')).toHaveLength(1);
        expect(
          pendingMessages.filter((message) => message.id === optimisticUserMessageId),
        ).toHaveLength(1);
        expect(pendingMessages.find((message) => message.id === optimisticUserMessageId)).toEqual(
          expect.objectContaining({
            audioList: [
              expect.objectContaining({
                id: 'uploaded-audio',
                url: 'https://example.com/voice.webm',
              }),
            ],
            files: ['uploaded-audio'],
            metadata: expect.objectContaining({ scope: LOCAL_MESSAGE_SCOPE }),
          }),
        );
        const request = executeGatewayAgent.mock.calls[0][0];
        // The server creates the topic under the minted id and adopts the voice
        // row's id as the user message.
        expect(request.clientIds).toEqual(
          expect.objectContaining({
            topicId: mintedTopicId,
            userMessageId: optimisticUserMessageId,
          }),
        );
        expect(request.context.topicId).toBeUndefined();
        expect(request.messageContext.topicId).toBe(mintedTopicId);

        await act(async () => {
          resolveGateway();
        });

        await waitFor(() =>
          expect(useChatStore.getState().voiceMessageUploadMap[optimisticUserMessageId]).toBe(
            undefined,
          ),
        );
      });

      it('should preserve a caller-owned optimistic user row when persistence fails before acceptance', async () => {
        const { result } = renderHook(() => useChatStore());
        const context = {
          agentId: TEST_IDS.SESSION_ID,
          threadId: null,
          topicId: TEST_IDS.TOPIC_ID,
        };
        const contextKey = messageMapKey(context);
        const optimisticUserMessageId = 'tmp-voice-message';
        const localVoiceMessage = createMockMessage({
          audioList: [
            {
              alt: 'voice.webm',
              durationMs: 1200,
              id: 'tmp-audio',
              mimeType: 'audio/webm',
              url: 'blob:voice-preview',
            },
          ],
          content: '',
          id: optimisticUserMessageId,
          metadata: { scope: LOCAL_MESSAGE_SCOPE },
          topicId: TEST_IDS.TOPIC_ID,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: TEST_IDS.SESSION_ID,
            activeTopicId: TEST_IDS.TOPIC_ID,
            dbMessagesMap: { [contextKey]: [localVoiceMessage] },
            messagesMap: { [contextKey]: [localVoiceMessage] },
          });
        });

        const onMessageAccepted = vi.fn();
        vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(
          new Error('persistence failed'),
        );

        await act(async () => {
          await result.current.sendMessage({
            context,
            files: [
              {
                audioMetadata: { durationMs: 1200, mimeType: 'audio/webm' },
                file: { name: 'voice.webm', type: 'audio/webm' },
                fileUrl: 'https://example.com/voice.webm',
                id: 'uploaded-audio',
                status: 'success',
              } as any,
            ],
            message: '',
            onMessageAccepted,
            optimisticUserMessageId,
            preserveComposer: true,
          });
        });

        const remainingMessages = useChatStore.getState().dbMessagesMap[contextKey];
        expect(onMessageAccepted).not.toHaveBeenCalled();
        expect(remainingMessages).toHaveLength(1);
        expect(remainingMessages[0]).toEqual(
          expect.objectContaining({
            id: optimisticUserMessageId,
            metadata: expect.objectContaining({ scope: LOCAL_MESSAGE_SCOPE }),
            role: 'user',
          }),
        );
        expect(remainingMessages.some((message) => message.role === 'assistant')).toBe(false);
      });

      it('should move a failed first-turn voice back to _new before retrying', async () => {
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const newContextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            activeAgentId: TEST_IDS.SESSION_ID,
            activeTopicId: undefined,
          });
        });

        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice-retry');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(useFileStore.getState(), 'uploadWithProgress').mockResolvedValue({
          id: 'uploaded-retry-audio',
          url: 'https://example.com/retry.webm',
        });

        const executeGatewayAgent = mockGatewayAgent();
        executeGatewayAgent
          .mockRejectedValueOnce(new Error('persistence failed'))
          .mockImplementationOnce(async (params: any) => {
            params.onMessageAccepted?.();
            useChatStore.getState().completeOperation(params.parentOperationId);
            return {
              assistantMessageId: params.clientIds.assistantMessageId,
              operationId: 'gateway-op-voice-retry',
              topicId: params.clientIds.topicId,
              userMessageId: params.clientIds.userMessageId,
            };
          });

        const sendThroughLifecycle: VoiceMessageSend = (file, options: VoiceMessageSendOptions) =>
          new Promise<void>((resolve, reject) => {
            let accepted = false;
            void result.current
              .sendMessage({
                context: options.context,
                files: [file],
                message: '',
                onMessageAccepted: () => {
                  accepted = true;
                  resolve();
                },
                optimisticUserMessageId: options.messageId,
                preserveComposer: true,
                signal: options.signal,
              })
              .then(() => {
                if (!accepted) reject(new Error('Voice message was not accepted'));
              }, reject);
          });

        let messageId!: string;
        act(() => {
          messageId = result.current.sendVoiceMessage({
            canSend: () => true,
            context,
            recording: {
              codec: 'opus',
              durationMs: 1200,
              file: new File(['voice'], 'voice.webm', { type: 'audio/webm' }),
              mimeType: 'audio/webm',
              waveform: [0.2, 0.8, 0.3],
            },
            send: sendThroughLifecycle,
          })!;
        });

        await waitFor(() =>
          expect(useChatStore.getState().voiceMessageUploadMap[messageId]?.status).toBe('failed'),
        );

        const failedTopicId = executeGatewayAgent.mock.calls[0][0].clientIds.topicId;
        const failedTopicKey = messageMapKey({ ...context, topicId: failedTopicId });
        const failedState = useChatStore.getState();
        const uploadOperation = Object.values(failedState.operations).find(
          (operation) =>
            operation.type === 'uploadVoiceMessage' && operation.context.messageId === messageId,
        );
        expect(failedTopicId).toMatch(/^tpc_/);
        expect(failedState.activeTopicId).toBeFalsy();
        expect(failedState.dbMessagesMap[newContextKey]?.map((message) => message.id)).toContain(
          messageId,
        );
        expect(failedState.dbMessagesMap[failedTopicKey] ?? []).toEqual([]);
        expect(uploadOperation?.context.topicId).toBeNull();

        act(() => result.current.retryVoiceMessage(messageId));

        await waitFor(() => expect(executeGatewayAgent).toHaveBeenCalledTimes(2));
        await waitFor(() =>
          expect(useChatStore.getState().voiceMessageUploadMap[messageId]).toBeUndefined(),
        );

        const retryRequest = executeGatewayAgent.mock.calls[1][0];
        expect(retryRequest.clientIds.topicId).toMatch(/^tpc_/);
        expect(retryRequest.clientIds.topicId).not.toBe(failedTopicId);
        expect(retryRequest.clientIds.userMessageId).toBe(messageId);
      });

      it('detaches the caller cancellation signal after an unaccepted persistence failure', async () => {
        const { result } = renderHook(() => useChatStore());
        const controller = new AbortController();
        vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(
          new TRPCClientError('persistence failed'),
        );

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            message: TEST_CONTENT.USER_MESSAGE,
            signal: controller.signal,
          });
        });
        const sendOperation = Object.values(result.current.operations).find(
          (operation) => operation.type === 'sendMessage',
        );
        expect(sendOperation?.status).toBe('failed');

        act(() => controller.abort(new DOMException('late cancel', 'AbortError')));

        expect(result.current.operations[sendOperation!.id]?.status).toBe('failed');
      });

      // Skill context is folded into the persisted user message on the
      // persistence path, which the direct @agent route still takes.
      it('should persist selected slash skills into user message content before sending', async () => {
        const { result } = renderHook(() => useChatStore());
        stubDirectMentionRun();

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: undefined,
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);
        vi.spyOn(toolStoreModule, 'getToolStoreState').mockReturnValue({
          agentSkillDetailMap: {},
          agentSkills: [],
          builtinSkills: [
            {
              content: 'Use the user memory skill content.',
              description: 'Load user memory',
              identifier: 'user_memory',
              name: 'User Memory',
              source: 'builtin',
            },
            {
              content: 'Use the instruction skill content.',
              description: 'Load instruction',
              identifier: 'instruction',
              name: 'Instruction',
              source: 'builtin',
            },
          ],
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: directMentionEditorData(' ', [
              {
                actionCategory: 'skill',
                actionLabel: 'User Memory',
                actionType: 'user_memory',
                type: 'action-tag',
              },
              {
                actionCategory: 'skill',
                actionLabel: 'Instruction',
                actionType: 'instruction',
                type: 'action-tag',
              },
            ]),
            message: '<action type="user_memory" category="skill" /> ' + TEST_CONTENT.USER_MESSAGE,
          });
        });

        const requestPayload = sendMessageInServerSpy.mock.calls[0]?.[0];

        expect(requestPayload?.newUserMessage).toEqual(
          expect.objectContaining({
            content: expect.stringContaining(TEST_CONTENT.USER_MESSAGE),
            editorData: expect.objectContaining({
              root: expect.any(Object),
            }),
          }),
        );
        expect(requestPayload?.newUserMessage.content).toContain('<selected_skill_context>');
        expect(requestPayload?.newUserMessage.content).toContain('identifier="user_memory"');
        expect(requestPayload?.newUserMessage.content).toContain('identifier="instruction"');
        expect(requestPayload?.newUserMessage.content).toContain(
          'Use the user memory skill content.',
        );
        expect(requestPayload?.newUserMessage.content).toContain(
          'Use the instruction skill content.',
        );
        expect(requestPayload?.preloadMessages).toBeUndefined();
        expect(requestPayload?.newUserMessage.editorData?.root.children[0].children).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actionCategory: 'skill',
              actionType: 'user_memory',
              type: 'action-tag',
            }),
          ]),
        );
      });

      // The server injects a selected skill's body from `selectedSkillIds` (and
      // recovers it on later turns), so the gateway message must not carry it too.
      it('should forward a selected skill by id without its body in the gateway message', async () => {
        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgent = mockGatewayAgent();
        vi.spyOn(toolStoreModule, 'getToolStoreState').mockReturnValue({
          agentSkillDetailMap: {},
          agentSkills: [],
          builtinSkills: [
            {
              content: 'Use the user memory skill content.',
              description: 'Load user memory',
              identifier: 'user_memory',
              name: 'User Memory',
              source: 'builtin',
            },
          ],
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        actionCategory: 'skill',
                        actionLabel: 'User Memory',
                        actionType: 'user_memory',
                        type: 'action-tag',
                      },
                      { text: ` ${TEST_CONTENT.USER_MESSAGE}`, type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            message: '<action type="user_memory" category="skill" /> ' + TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledTimes(1);
        const { message, selectedSkillIds } = executeGatewayAgent.mock.calls[0][0];
        expect(message).toContain(TEST_CONTENT.USER_MESSAGE);
        expect(message).not.toContain('<selected_skill_context>');
        expect(message).not.toContain('Use the user memory skill content.');
        expect(selectedSkillIds).toEqual(['user_memory']);
      });

      // Regression: the gateway request only carried steer/trigger, so the
      // server-created user row lost the selected page context.
      it('should send selected page context with the gateway run metadata', async () => {
        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgent = mockGatewayAgent();
        const pageSelections = [
          { content: 'picked text', id: 'sel-1', pageId: 'page-1', xml: '<p>picked text</p>' },
        ] as any;

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            message: TEST_CONTENT.USER_MESSAGE,
            pageSelections,
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({ metadata: expect.objectContaining({ pageSelections }) }),
        );
      });

      // Regression: a drained queued follow-up carries its selections only in
      // `metadata`, and the editor state never reached the server-created row.
      it('should send queued selections and the editor state with the gateway run', async () => {
        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgent = mockGatewayAgent();
        const pageSelections = [
          { content: 'queued text', id: 'sel-2', pageId: 'page-1', xml: '<p>queued text</p>' },
        ] as any;
        const editorData = {
          root: {
            children: [
              { children: [{ text: TEST_CONTENT.USER_MESSAGE, type: 'text' }], type: 'paragraph' },
            ],
            type: 'root',
          },
        } as any;

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData,
            message: TEST_CONTENT.USER_MESSAGE,
            metadata: { pageSelections, steer: true } as any,
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            editorData,
            metadata: expect.objectContaining({ pageSelections, steer: true }),
          }),
        );
      });

      it('should work when sending from home page (activeAgentId is empty but context.agentId exists)', async () => {
        const { result } = renderHook(() => useChatStore());

        // Simulate home page state where activeAgentId is empty
        act(() => {
          useChatStore.setState({
            activeAgentId: '',
            activeTopicId: undefined,
          });
        });

        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            // Pass agentId via context (simulating home page sending to inbox)
            context: createTestContext('inbox-agent-id'),
          });
        });

        // Should run the agent from context, with its model pinned on the new topic
        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({ agentId: 'inbox-agent-id' }),
            optimisticTopic: expect.objectContaining({
              model: expect.any(String),
              provider: expect.any(String),
            }),
          }),
        );
      });

      // Regression: the browser client runtime is gone. A deployment without an
      // Agent Gateway (or with Gateway mode switched off) must not silently fall
      // back to running the agent locally, nor push the run to a disabled
      // gateway: the send fails with the "not configured" error instead.
      it('should fail a normal send when gateway mode is off, without any local fallback', async () => {
        const { result } = renderHook(() => useChatStore());
        // serverConfig carries no agentGatewayUrl in tests
        expect(result.current.isGatewayModeEnabled()).toBe(false);

        const executeGatewayAgent = vi.fn().mockImplementation(async (params: any) => {
          useChatStore.getState().completeOperation(params.parentOperationId);
          return {
            assistantMessageId: params.clientIds.assistantMessageId,
            operationId: 'gateway-op-off',
            topicId: TEST_IDS.TOPIC_ID,
            userMessageId: params.clientIds.userMessageId,
          };
        });
        const sendMessageInServerSpy = vi.spyOn(aiChatService, 'sendMessageInServer');
        act(() => {
          useChatStore.setState({ executeGatewayAgent });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: { ...createTestContext(), topicId: TEST_IDS.TOPIC_ID },
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(executeGatewayAgent).not.toHaveBeenCalled();
        expect(sendMessageInServerSpy).not.toHaveBeenCalled();
        const failedSend = Object.values(useChatStore.getState().operations).find(
          (op) => op.type === 'sendMessage',
        );
        expect(failedSend?.status).toBe('failed');
        expect(failedSend?.metadata.error?.message).toBe(
          t('gateway.notConfigured', { ns: 'chat' }),
        );
      });

      it('should adopt the minted topic id and move context added during preflight', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const newBucketKey = messageMapKey({ agentId, topicId: null });
        let resolveSkillPreload!: (value: []) => void;
        const skillPreloadPromise = new Promise<[]>((resolve) => {
          resolveSkillPreload = resolve;
        });
        const skillPreloadSpy = vi
          .spyOn(skillPreload, 'resolveSelectedSkillsWithContent')
          .mockReturnValue(skillPreloadPromise);
        let resolveGateway!: () => void;
        let sentNewTopicId: string | undefined;

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
          });
        });

        const executeGatewayAgentSpy = mockGatewayAgent(
          (params: any) =>
            new Promise<any>((resolve) => {
              sentNewTopicId = params.clientIds.topicId;
              resolveGateway = () => {
                // Mirror executeGatewayAgent: the server confirms the minted id.
                useChatStore.getState().internal_replaceTopicId({
                  nextId: params.optimisticTopic.id,
                  previousId: params.optimisticTopic.id,
                });
                useChatStore.getState().completeOperation(params.parentOperationId);
                resolve({
                  assistantMessageId: params.clientIds.assistantMessageId,
                  operationId: 'gateway-op-minted',
                  topicId: params.clientIds.topicId,
                  userMessageId: params.clientIds.userMessageId,
                });
              };
            }),
        );

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: 'first message',
          });
        });

        await waitFor(() => expect(skillPreloadSpy).toHaveBeenCalled());

        const pendingSelection = {
          content: 'context added while preparing the first send',
          id: 'pending-selection',
          type: 'text' as const,
        };
        act(() => {
          useFileStore.getState().addChatContextSelection({
            contextKey: newBucketKey,
            selection: pendingSelection,
          });
          resolveSkillPreload([]);
        });

        await waitFor(() => expect(executeGatewayAgentSpy).toHaveBeenCalled());

        // The conversation adopted the minted id BEFORE the server answered:
        // activeTopicId already points at it, the optimistic pair lives in the
        // minted bucket (NOT `_new`), and the id is marked as creating.
        const midState = useChatStore.getState();
        const mintedTopicId = midState.activeTopicId!;
        expect(mintedTopicId).toMatch(/^tpc_/);
        expect(sentNewTopicId).toBe(mintedTopicId);
        expect(midState.creatingTopicIds).toContain(mintedTopicId);

        const mintedBucketKey = messageMapKey({ agentId, topicId: mintedTopicId });
        expect(midState.dbMessagesMap[mintedBucketKey]?.length).toBe(2);
        expect(midState.dbMessagesMap[newBucketKey] ?? []).toEqual([]);
        expect(
          fileChatSelectors.chatContextSelections(mintedBucketKey)(useFileStore.getState()),
        ).toEqual([pendingSelection]);
        expect(
          fileChatSelectors.chatContextSelections(newBucketKey)(useFileStore.getState()),
        ).toEqual([]);

        await act(async () => {
          resolveGateway();
          await sendPromise;
        });

        const endState = useChatStore.getState();
        // Same id end to end — nothing re-keyed, nothing remounted.
        expect(endState.activeTopicId).toBe(mintedTopicId);
        // Server confirmed: the id must leave the creating set so fetching and
        // refetch reconciliation return to normal.
        expect(endState.creatingTopicIds).not.toContain(mintedTopicId);
      });

      it('should return composer context ownership when preflight fails', async () => {
        const { result } = renderHook(() => useChatStore());
        const preflightError = new Error('skill preload failed');
        const onPreflightFailure = vi.fn();
        vi.spyOn(skillPreload, 'resolveSelectedSkillsWithContent').mockRejectedValue(
          preflightError,
        );

        await expect(
          result.current.sendMessage({
            context: createTestContext(),
            message: TEST_CONTENT.USER_MESSAGE,
            onPreflightFailure,
          }),
        ).rejects.toBe(preflightError);

        expect(onPreflightFailure).toHaveBeenCalledOnce();
        expect(result.current.operations).toEqual({});
      });

      it('should snapshot the agent model onto the newTopic (top-level) when the send creates the topic', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        vi.spyOn(aiModelSelectors, 'isModelHasReasoningExtendParams').mockReturnValue(() => true);
        let loaded = false;
        vi.spyOn(aiModelSelectors, 'isModelReasoningConfigLoaded').mockReturnValue(() => loaded);
        vi.spyOn(useAiInfraStore.getState(), 'ensureModelReasoningConfig').mockImplementation(
          async () => {
            await Promise.resolve();
            loaded = true;
          },
        );
        vi.spyOn(aiModelSelectors, 'modelReasoningConfig').mockReturnValue(() => ({
          reasoningEffort: 'high',
        }));

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
          });
        });
        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        // The server creates the topic from this placeholder, so the snapshot
        // (top-level model columns + reasoning effort) has to ride on it.
        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            optimisticTopic: expect.objectContaining({
              metadata: expect.objectContaining({ reasoningConfig: { reasoningEffort: 'high' } }),
              model: expect.any(String),
              provider: expect.any(String),
            }),
          }),
        );
      });

      it('reports an isolated gateway topic at acceptance and returns its ID', async () => {
        const onTopicCreated = vi.fn();
        const executeGatewayAgent = vi.fn().mockImplementation(async (params) => {
          await params.onTopicCreated?.(TEST_IDS.NEW_TOPIC_ID);
          expect(onTopicCreated).toHaveBeenCalledWith(TEST_IDS.NEW_TOPIC_ID);
          useChatStore.getState().completeOperation(params.parentOperationId);
          return {
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            topicId: TEST_IDS.NEW_TOPIC_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          };
        });
        useChatStore.setState({
          executeGatewayAgent,
          isGatewayModeEnabled: () => true,
        });

        const result = await useChatStore.getState().sendMessage({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            isNew: true,
            isolatedTopic: true,
            scope: 'main',
          },
          message: 'Continue the forwarded work',
          onTopicCreated,
        });

        expect(onTopicCreated).toHaveBeenCalledTimes(1);
        expect(result?.createdTopicId).toBe(TEST_IDS.NEW_TOPIC_ID);
      });

      it('should stop the sidebar spinner after a gateway send creates the topic', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        const newTopicId = TEST_IDS.NEW_TOPIC_ID;
        let resolveGateway!: () => void;
        const executeGatewayAgentSpy = vi.fn().mockImplementation(
          (params: any) =>
            new Promise<any>((resolve) => {
              resolveGateway = () => {
                // Mimic executeGatewayAgent's contract: execAgentTask resolves
                // the optimistic topic via internal_replaceTopicId, and the
                // parent sendMessage op is completed once phase-1 init is done
                // (without this the leaked running op pollutes later tests —
                // resetTestEnvironment does not clear `operations`).
                useChatStore.getState().internal_replaceTopicId({
                  nextId: newTopicId,
                  previousId: params.optimisticTopic.id,
                });
                useChatStore.getState().completeOperation(params.parentOperationId);
                resolve({
                  assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
                  operationId: 'gateway-op-release',
                  topicId: newTopicId,
                  userMessageId: TEST_IDS.USER_MESSAGE_ID,
                });
              };
            }),
        );

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: 'hello',
          });
        });

        await waitFor(() => expect(executeGatewayAgentSpy).toHaveBeenCalled());

        const optimisticTopicId = useChatStore.getState().topicDataMap[topicKey]?.items[0]?.id;
        expect(optimisticTopicId).toMatch(/^tpc_/);
        // The running sendMessage op keeps the spinner on during phase-1 init.
        expect(
          operationSelectors.isTopicVisiblyRunning(optimisticTopicId!)(useChatStore.getState()),
        ).toBe(true);

        await act(async () => {
          resolveGateway();
          await sendPromise;
          // Let the fire-and-forget afterUserMessagePersisted title task settle
          // inside this test instead of leaking into the next one.
          await Promise.resolve();
          await Promise.resolve();
        });

        // From here the run spinner is owned by the persisted
        // `status === 'running'` — no client-side operation may keep spinning
        // for either id, or the sidebar spinner sticks after the run.
        expect(operationSelectors.isTopicVisiblyRunning(newTopicId)(useChatStore.getState())).toBe(
          false,
        );
        expect(
          operationSelectors.isTopicVisiblyRunning(optimisticTopicId!)(useChatStore.getState()),
        ).toBe(false);
      });

      it('keeps persisted gateway messages when caller cancellation wins after acceptance', async () => {
        const { result } = renderHook(() => useChatStore());
        const controller = new AbortController();
        const context = {
          agentId: TEST_IDS.SESSION_ID,
          threadId: null,
          topicId: TEST_IDS.TOPIC_ID,
        };
        let gatewayParams: any;
        let resolveGateway!: () => void;
        const executeGatewayAgentSpy = vi.fn().mockImplementation(
          (params: any) =>
            new Promise<any>((resolve) => {
              gatewayParams = params;
              resolveGateway = () =>
                resolve({
                  assistantMessageId: gatewayParams.clientIds.assistantMessageId,
                  operationId: 'gateway-op-cancelled-after-persistence',
                  topicId: TEST_IDS.TOPIC_ID,
                  userMessageId: gatewayParams.clientIds.userMessageId,
                });
            }),
        );
        const internalDispatchMessageSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

        act(() => {
          useChatStore.setState({
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
          });
        });

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context,
            message: TEST_CONTENT.USER_MESSAGE,
            signal: controller.signal,
          });
        });
        await waitFor(() => expect(executeGatewayAgentSpy).toHaveBeenCalledOnce());

        act(() => controller.abort(new DOMException('cancelled', 'AbortError')));
        await act(async () => {
          gatewayParams.onMessageAccepted();
          resolveGateway();
          await sendPromise;
        });

        expect(internalDispatchMessageSpy).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: 'deleteMessages' }),
          expect.anything(),
        );
        expect(
          (result.current.messagesMap[messageMapKey(context)] ?? []).map((message) => message.id),
        ).toEqual(
          expect.arrayContaining([
            gatewayParams.clientIds.userMessageId,
            gatewayParams.clientIds.assistantMessageId,
          ]),
        );
      });

      it('should keep the sidebar spinner on through a hetero new-topic run and stop it at the end', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        const newTopicId = TEST_IDS.NEW_TOPIC_ID;

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: true,
          messages: [
            createMockMessage({
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              topicId: newTopicId,
            }),
            createMockMessage({
              id: TEST_IDS.ASSISTANT_MESSAGE_ID,
              role: 'assistant',
              topicId: newTopicId,
            }),
          ],
          topicId: newTopicId,
          topics: { items: [{ id: newTopicId, title: 'Server Topic' }], total: 1 },
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        let resolveExecutor!: () => void;
        executeHeterogeneousAgentMock.mockImplementation(
          (_getStore: unknown, opts: { operationId: string }) =>
            new Promise<void>((resolve) => {
              resolveExecutor = () => {
                // The real executor settles its execHeterogeneousAgent op at
                // the terminal; without this the leaked running op would keep
                // the spinner on (and pollute later tests).
                useChatStore.getState().completeOperation(opts.operationId);
                resolve();
              };
            }),
        );

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: 'hello',
          });
        });

        await waitFor(() => expect(executeHeterogeneousAgentMock).toHaveBeenCalled());

        // The executor only writes the persisted `status === 'running'` (the
        // run spinner's other driver) after startSession resolves — the running
        // execHeterogeneousAgent operation must keep the spinner on while the
        // executor starts up, or it blanks during a slow CLI startup.
        expect(operationSelectors.isTopicVisiblyRunning(newTopicId)(useChatStore.getState())).toBe(
          true,
        );

        await act(async () => {
          resolveExecutor();
          await sendPromise;
          // Let the fire-and-forget afterUserMessagePersisted title task settle
          // inside this test instead of leaking into the next one.
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(operationSelectors.isTopicVisiblyRunning(newTopicId)(useChatStore.getState())).toBe(
          false,
        );
      });

      it('notifies an isolated hetero caller before execution and returns its created topic', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        const newTopicId = TEST_IDS.NEW_TOPIC_ID;

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: true,
          messages: [
            createMockMessage({
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              topicId: newTopicId,
            }),
            createMockMessage({
              id: TEST_IDS.ASSISTANT_MESSAGE_ID,
              role: 'assistant',
              topicId: newTopicId,
            }),
          ],
          topicId: newTopicId,
          topics: { items: [{ id: newTopicId, title: 'Server Topic' }], total: 1 },
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        let resolveExecutor!: () => void;
        executeHeterogeneousAgentMock.mockImplementation(
          (_getStore: unknown, opts: { operationId: string }) =>
            new Promise<void>((resolve) => {
              resolveExecutor = () => {
                // The real executor settles its execHeterogeneousAgent op at
                // the terminal; without this the leaked running op would keep
                // the spinner on (and pollute later tests).
                useChatStore.getState().completeOperation(opts.operationId);
                resolve();
              };
            }),
        );

        const onTopicCreated = vi.fn();
        const switchTopic = vi.spyOn(useChatStore.getState(), 'switchTopic');
        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, isNew: true, isolatedTopic: true, scope: 'main' },
            onTopicCreated,
            message: 'hello',
          });
        });

        await waitFor(() => expect(executeHeterogeneousAgentMock).toHaveBeenCalled());

        expect(onTopicCreated).toHaveBeenCalledWith(newTopicId);
        expect(switchTopic).not.toHaveBeenCalled();

        // The executor only writes the persisted `status === 'running'` (the
        // run spinner's other driver) after startSession resolves — the running
        // execHeterogeneousAgent operation must keep the spinner on while the
        // executor starts up, or it blanks during a slow CLI startup.
        expect(operationSelectors.isTopicVisiblyRunning(newTopicId)(useChatStore.getState())).toBe(
          true,
        );

        await act(async () => {
          resolveExecutor();
          expect(await sendPromise).toEqual(
            expect.objectContaining({ createdTopicId: newTopicId }),
          );
          // Let the fire-and-forget afterUserMessagePersisted title task settle
          // inside this test instead of leaking into the next one.
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(operationSelectors.isTopicVisiblyRunning(newTopicId)(useChatStore.getState())).toBe(
          false,
        );
      });

      it('should keep a gateway optimistic topic in its pending repo project group', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        const selectedRepo = 'https://github.com/lobehub/lobehub';
        let resolveGateway!: () => void;
        const gatewayPromise = new Promise<any>((resolve) => {
          resolveGateway = () =>
            resolve({
              assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
              operationId: 'gateway-op-1',
              userMessageId: TEST_IDS.USER_MESSAGE_ID,
            });
        });
        const executeGatewayAgentSpy = vi.fn().mockReturnValue(gatewayPromise);

        setPendingTopicRepos(agentId, [selectedRepo]);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: 'Create a project topic',
          });
        });

        await waitFor(() => expect(executeGatewayAgentSpy).toHaveBeenCalled());

        // A pending repo selected before the first send used to be missing from
        // the tmp topic, so By Project grouped it under "No directory" until
        // the server topic replaced it.
        expect(useChatStore.getState().topicDataMap[topicKey]?.items[0]).toEqual(
          expect.objectContaining({
            // Pinned model is a top-level column, not metadata.
            model: expect.any(String),
            provider: expect.any(String),
            metadata: {
              repos: [selectedRepo],
              workingDirectory: selectedRepo,
              workingDirectoryConfig: { path: selectedRepo, repoType: 'github' },
            },
          }),
        );
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            optimisticTopic: expect.objectContaining({
              model: expect.any(String),
              provider: expect.any(String),
              metadata: {
                repos: [selectedRepo],
                workingDirectory: selectedRepo,
                workingDirectoryConfig: { path: selectedRepo, repoType: 'github' },
              },
            }),
          }),
        );

        await act(async () => {
          resolveGateway();
          await sendPromise;
        });
      });

      // A native (non-hetero) agent bound to a device resolves its cwd for the
      // run (tools, {{workingDirectory}}) but used to leave the new topic
      // unbound — By Project filed every such conversation under "No directory",
      // and later turns re-resolved the agent-level default, so changing the
      // agent's directory silently moved old topics to another project.
      it('should bind a new gateway topic to a native agent device working directory', async () => {
        mockConstEnv.isDesktop = true;
        const deviceId = 'device-1';
        const sourcePath = '/repo/lobehub';
        const worktreePath = '/repo/lobehub/.worktrees/feat';
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: deviceId,
              executionTarget: 'local',
              workingDirByDevice: {
                [deviceId]: {
                  git: { activeWorktree: worktreePath },
                  path: sourcePath,
                  repoType: 'github',
                },
              },
            },
          },
        });

        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        let resolveGateway!: () => void;
        const gatewayPromise = new Promise<any>((resolve) => {
          resolveGateway = () =>
            resolve({
              assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
              operationId: 'gateway-op-cwd',
              topicId: TEST_IDS.NEW_TOPIC_ID,
              userMessageId: TEST_IDS.USER_MESSAGE_ID,
            });
        });
        const executeGatewayAgentSpy = vi.fn().mockReturnValue(gatewayPromise);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: 'Bind me to the project',
          });
        });

        await waitFor(() => expect(executeGatewayAgentSpy).toHaveBeenCalled());

        // `workingDirectory` is the EFFECTIVE path (the checked-out worktree the
        // run executes in); the config keeps the SOURCE repo, which is what
        // By-Project groups on. The machine is recorded with it, so the next
        // turn stays there after the agent default changes.
        const expectedMetadata = {
          boundDeviceId: deviceId,
          workingDirectory: worktreePath,
          workingDirectoryConfig: {
            git: { activeWorktree: worktreePath },
            path: sourcePath,
            repoType: 'github',
          },
        };
        expect(useChatStore.getState().topicDataMap[topicKey]?.items[0]).toEqual(
          expect.objectContaining({ metadata: expectedMetadata }),
        );
        // Rides along to the server, which owns the real topic row.
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            optimisticTopic: expect.objectContaining({ metadata: expectedMetadata }),
          }),
        );

        await act(async () => {
          resolveGateway();
          await sendPromise;
        });
      });

      it('should fall back to the bound device default cwd when the agent has no pick', async () => {
        mockConstEnv.isDesktop = true;
        const deviceId = 'device-1';
        setupMockSelectors({
          agentConfig: {
            agencyConfig: { boundDeviceId: deviceId, executionTarget: 'device' },
          },
        });
        act(() => {
          useDeviceStore.setState({
            deviceListMap: { all: [{ defaultCwd: '/repo/default', deviceId, name: 'Mac' }] as any },
          });
        });

        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'gateway-op-default-cwd',
          topicId: TEST_IDS.NEW_TOPIC_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: 'Use the device default',
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            optimisticTopic: expect.objectContaining({
              metadata: {
                boundDeviceId: deviceId,
                workingDirectory: '/repo/default',
                workingDirectoryConfig: { path: '/repo/default' },
              },
            }),
          }),
        );
      });

      // A native agent with no directory configured is a valid setup, but the
      // topic still has to remember its machine so later turns stay there.
      it('should pin a new topic to its device even without a directory', async () => {
        mockConstEnv.isDesktop = true;
        const deviceId = 'device-1';
        setupMockSelectors({
          agentConfig: {
            agencyConfig: { boundDeviceId: deviceId, executionTarget: 'local' },
          },
        });

        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId: TEST_IDS.SESSION_ID, threadId: null, topicId: null },
            message: 'No directory here',
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            optimisticTopic: expect.objectContaining({ metadata: { boundDeviceId: deviceId } }),
          }),
        );
      });

      it('should leave a plain-chat agent topic unbound', async () => {
        mockConstEnv.isDesktop = true;
        const deviceId = 'device-1';
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: deviceId,
              executionTarget: 'local',
              workingDirByDevice: { [deviceId]: { path: '/repo/lobehub' } },
            },
            // No execution environment at all — a directory would be noise, and
            // By Project would file plain chats under a project they never used.
            chatConfig: { ...createMockAgentConfig().chatConfig, enableAgentMode: false },
          },
        });

        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'gateway-op-chat',
          topicId: TEST_IDS.NEW_TOPIC_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: 'Just chatting',
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            optimisticTopic: expect.not.objectContaining({ metadata: expect.anything() }),
          }),
        );
      });

      // The device `defaultCwd` level was added to the SEND path by the same
      // change that started binding native topics, and it sits BETWEEN the
      // legacy per-agent slot and the desktop/home fallback. A local
      // heterogeneous CLI keys its sessions off the cwd
      // (`~/.claude/projects/<encoded-cwd>/`), so reordering these levels moves
      // an agent's whole session bucket and silently drops `--resume` — pin the
      // order for the hetero path, which the native-agent cases above don't
      // exercise (they never reach the desktop/home fallback at all).
      describe('heterogeneous cwd precedence', () => {
        const HETERO_DEVICE_ID = 'device-1';
        const DESKTOP_PATH = '/Users/me/Desktop';

        const setupHeteroRun = (agencyConfig: Record<string, any> = {}) => {
          mockConstEnv.isDesktop = true;
          setupMockSelectors({
            agentConfig: {
              agencyConfig: {
                boundDeviceId: HETERO_DEVICE_ID,
                executionTarget: 'local',
                heterogeneousProvider: { command: 'codex', type: 'codex' },
                ...agencyConfig,
              },
            },
          });
          executeHeterogeneousAgentMock.mockResolvedValue(undefined);

          return vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topicId: TEST_IDS.NEW_TOPIC_ID,
            topics: [],
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);
        };

        const sendHeteroMessage = async () => {
          const { result } = renderHook(() => useChatStore());
          await act(async () => {
            await result.current.sendMessage({
              context: createTestContext(),
              message: TEST_CONTENT.USER_MESSAGE,
            });
          });
        };

        beforeEach(() => {
          // The desktop/home fallback is always available for a hetero CLI, so
          // every case below has something to lose to.
          window.__LOBE_GLOBAL_AGENT_CONTEXT__ = { desktopPath: DESKTOP_PATH };
        });

        it('snapshots the heterogeneous effort and speed into the first-send topic', async () => {
          const sendSpy = setupHeteroRun({
            heterogeneousProvider: {
              args: ['-c', 'service_tier="fast"'],
              command: 'codex',
              effort: 'high',
              type: 'codex',
            },
          });
          await sendHeteroMessage();
          expect(sendSpy.mock.calls[0][0].newTopic?.metadata).toMatchObject({
            heteroEffort: 'high',
            heteroSpeed: 'fast',
          });
        });

        it('prefers the bound device defaultCwd over the desktop fallback', async () => {
          const sendMessageInServerSpy = setupHeteroRun();
          act(() => {
            useDeviceStore.setState({
              deviceListMap: {
                all: [
                  { defaultCwd: '/repo/device-default', deviceId: HETERO_DEVICE_ID, name: 'Mac' },
                ] as any,
              },
            });
          });

          await sendHeteroMessage();

          // The CLI actually spawns here — a regression sends it to ~/Desktop
          // and the `--resume` session bucket moves with it.
          expect(executeHeterogeneousAgentMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
              workingDirectory: '/repo/device-default',
              workingDirectoryConfig: { path: '/repo/device-default' },
            }),
          );
          // …and the topic is born pinned to the same directory.
          expect(sendMessageInServerSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              newTopic: expect.objectContaining({
                metadata: {
                  boundDeviceId: HETERO_DEVICE_ID,
                  workingDirectory: '/repo/device-default',
                  workingDirectoryConfig: { path: '/repo/device-default' },
                },
              }),
            }),
            expect.any(AbortController),
          );
        });

        // The topic ran on another machine, where its cwd and CLI session live.
        // An agent default of `local` must not pull its next turn onto this
        // desktop — the run goes through the gateway to the topic's machine.
        it('keeps a topic pinned to another machine off the in-process runtime', async () => {
          setupHeteroRun();
          const agentId = TEST_IDS.SESSION_ID;
          const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            operationId: 'gateway-op-remote-topic',
            topicId: 'remote-topic',
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          });
          act(() => {
            useChatStore.setState({
              executeGatewayAgent: executeGatewayAgentSpy,
              isGatewayModeEnabled: () => true,
              topicDataMap: {
                [topicMapKey({ agentId })]: {
                  currentPage: 0,
                  hasMore: false,
                  isExpandingPageSize: false,
                  isLoadingMore: false,
                  items: [
                    {
                      agentId,
                      createdAt: 0,
                      id: 'remote-topic',
                      metadata: {
                        boundDeviceId: 'remote-device',
                        workingDirectory: '/remote/repo',
                      },
                      title: 'Remote work',
                      updatedAt: 0,
                    } as any,
                  ],
                  pageSize: 20,
                  total: 1,
                },
              },
            });
          });

          const { result } = renderHook(() => useChatStore());
          await act(async () => {
            await result.current.sendMessage({
              context: { agentId, threadId: null, topicId: 'remote-topic' },
              message: 'Continue there',
            });
          });

          expect(executeHeterogeneousAgentMock).not.toHaveBeenCalled();
          expect(executeGatewayAgentSpy).toHaveBeenCalled();
        });

        it('keeps the agent per-device pick above the device defaultCwd', async () => {
          setupHeteroRun({
            workingDirByDevice: { [HETERO_DEVICE_ID]: { path: '/repo/agent-pick' } },
          });
          act(() => {
            useDeviceStore.setState({
              deviceListMap: {
                all: [
                  { defaultCwd: '/repo/device-default', deviceId: HETERO_DEVICE_ID, name: 'Mac' },
                ] as any,
              },
            });
          });

          await sendHeteroMessage();

          expect(executeHeterogeneousAgentMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ workingDirectory: '/repo/agent-pick' }),
          );
        });

        it('still falls back to the desktop path when neither the agent nor the device has one', async () => {
          setupHeteroRun();

          await sendHeteroMessage();

          // Inserting the defaultCwd level must not swallow the last resort: a
          // hetero CLI always spawns somewhere, so an unconfigured agent still
          // needs a directory (unlike a native one, which stays unbound).
          expect(executeHeterogeneousAgentMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ workingDirectory: DESKTOP_PATH }),
          );
        });
      });

      it('should rollback an optimistic topic if the create response resolves without a topic id', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        const executeGatewayAgent = mockGatewayAgent(async (params: any) => {
          useChatStore.getState().completeOperation(params.parentOperationId);
          return {
            assistantMessageId: params.clientIds.assistantMessageId,
            operationId: 'gateway-op-no-topic',
            userMessageId: params.clientIds.userMessageId,
          };
        });

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledOnce();
        expect(useChatStore.getState().topicDataMap[topicKey]?.items ?? []).toEqual([]);
        expect(operationSelectors.visiblyRunningTopicIds(useChatStore.getState()).size).toBe(0);
      });

      it('should show a group optimistic topic in the group topic bucket', async () => {
        const { result } = renderHook(() => useChatStore());
        const groupId = 'group-1';
        const supervisorAgentId = 'supervisor-agent';
        const groupKey = topicMapKey({ groupId });
        const groupAgentKey = topicMapKey({ agentId: supervisorAgentId, groupId });
        let resolveGateway!: (topicId?: string) => void;

        vi.spyOn(agentGroupStore, 'getChatGroupStoreState').mockReturnValue({
          groupMap: {
            [groupId]: {
              id: groupId,
              supervisorAgentId,
            },
          },
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: undefined,
            activeGroupId: groupId,
            activeTopicId: undefined,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [groupKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        const executeGatewayAgent = mockGatewayAgent(
          (params: any) =>
            new Promise<any>((resolve) => {
              resolveGateway = (topicId?: string) => {
                if (topicId)
                  useChatStore.getState().internal_replaceTopicId({
                    groupId: params.context.groupId ?? undefined,
                    nextId: topicId,
                    previousId: params.optimisticTopic.id,
                  });
                useChatStore.getState().completeOperation(params.parentOperationId);
                resolve({
                  assistantMessageId: params.clientIds.assistantMessageId,
                  operationId: 'gateway-op-pending',
                  topicId,
                  userMessageId: params.clientIds.userMessageId,
                });
              };
            }),
        );

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: {
              agentId: supervisorAgentId,
              groupId,
              scope: 'group',
              threadId: null,
              topicId: null,
            },
            message: 'Group first message',
          });
        });

        await waitFor(() =>
          expect(useChatStore.getState().topicDataMap[groupKey]?.items[0]?.id).toMatch(/^tpc_/),
        );

        const optimisticTopic = useChatStore.getState().topicDataMap[groupKey]?.items[0];
        expect(optimisticTopic).toEqual(
          expect.objectContaining({
            title: 'Group first message',
          }),
        );
        expect(useChatStore.getState().topicDataMap[groupAgentKey]?.items ?? []).toEqual([]);

        await act(async () => {
          resolveGateway(TEST_IDS.NEW_TOPIC_ID);
          await sendPromise;
        });

        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            optimisticTopic: expect.objectContaining({ id: optimisticTopic!.id }),
          }),
        );
        expect(useChatStore.getState().topicDataMap[groupKey]?.items).toEqual([
          expect.objectContaining({ id: TEST_IDS.NEW_TOPIC_ID, title: 'Group first message' }),
        ]);
        expect(useChatStore.getState().topicDataMap[groupAgentKey]?.items ?? []).toEqual([]);
      });

      it('should clear the active temp topic when rolling back an optimistic topic', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        let resolveGateway!: (topicId?: string) => void;

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        mockGatewayAgent(
          (params: any) =>
            new Promise<any>((resolve) => {
              resolveGateway = (topicId?: string) => {
                if (topicId)
                  useChatStore.getState().internal_replaceTopicId({
                    groupId: params.context.groupId ?? undefined,
                    nextId: topicId,
                    previousId: params.optimisticTopic.id,
                  });
                useChatStore.getState().completeOperation(params.parentOperationId);
                resolve({
                  assistantMessageId: params.clientIds.assistantMessageId,
                  operationId: 'gateway-op-pending',
                  topicId,
                  userMessageId: params.clientIds.userMessageId,
                });
              };
            }),
        );

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        await waitFor(() =>
          expect(useChatStore.getState().topicDataMap[topicKey]?.items[0]?.id).toMatch(/^tpc_/),
        );
        const optimisticTopicId = useChatStore.getState().topicDataMap[topicKey]!.items[0].id;

        act(() => {
          useChatStore.setState({ activeTopicId: optimisticTopicId });
        });

        await act(async () => {
          // The server answered without a topic: the placeholder rolls back.
          resolveGateway();
          await sendPromise;
        });

        expect(useChatStore.getState().topicDataMap[topicKey]?.items ?? []).toEqual([]);
        expect(useChatStore.getState().activeTopicId).not.toBe(optimisticTopicId);
      });

      it('should restore optimistic topic selections after switching away before rollback', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        const newContextKey = messageMapKey({ agentId, topicId: null });
        const otherTopicId = 'other-topic';
        let resolveGateway!: (topicId?: string) => void;

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        mockGatewayAgent(
          (params: any) =>
            new Promise<any>((resolve) => {
              resolveGateway = (topicId?: string) => {
                if (topicId)
                  useChatStore.getState().internal_replaceTopicId({
                    groupId: params.context.groupId ?? undefined,
                    nextId: topicId,
                    previousId: params.optimisticTopic.id,
                  });
                useChatStore.getState().completeOperation(params.parentOperationId);
                resolve({
                  assistantMessageId: params.clientIds.assistantMessageId,
                  operationId: 'gateway-op-pending',
                  topicId,
                  userMessageId: params.clientIds.userMessageId,
                });
              };
            }),
        );

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        await waitFor(() =>
          expect(useChatStore.getState().topicDataMap[topicKey]?.items[0]?.id).toMatch(/^tpc_/),
        );
        const optimisticTopicId = useChatStore.getState().topicDataMap[topicKey]!.items[0].id;
        const optimisticContextKey = messageMapKey({ agentId, topicId: optimisticTopicId });
        const pendingSelection = {
          content: 'context added before the failed send',
          id: 'rollback-selection',
          type: 'text' as const,
        };

        act(() => {
          useFileStore.getState().addChatContextSelection({
            contextKey: optimisticContextKey,
            selection: pendingSelection,
          });
          useChatStore.setState({ activeTopicId: otherTopicId });
        });

        await act(async () => {
          // The server answered without a topic: the placeholder rolls back.
          resolveGateway();
          await sendPromise;
        });

        expect(useChatStore.getState().activeTopicId).toBe(otherTopicId);
        expect(useChatStore.getState().topicDataMap[topicKey]?.items ?? []).toEqual([]);
        expect(
          fileChatSelectors.chatContextSelections(newContextKey)(useFileStore.getState()),
        ).toEqual([pendingSelection]);
        expect(
          fileChatSelectors.chatContextSelections(optimisticContextKey)(useFileStore.getState()),
        ).toEqual([]);
      });

      it('should forward selected tool tags to the gateway run', async () => {
        const { result } = renderHook(() => useChatStore());

        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        actionCategory: 'tool',
                        actionLabel: 'Notebook',
                        actionType: 'lobe-notebook',
                        type: 'action-tag',
                      },
                      {
                        actionCategory: 'tool',
                        actionLabel: 'Artifacts',
                        actionType: 'lobe-artifacts',
                        type: 'action-tag',
                      },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            // The selected-tool context rides along in the persisted user message.
            message: expect.stringContaining(TEST_CONTENT.USER_MESSAGE),
            selectedToolIds: ['lobe-notebook', 'lobe-artifacts'],
          }),
        );
      });

      // Partial persistence responses only come back on the direct @agent route.
      it('should merge partial persisted messages into existing topic history', async () => {
        const { result } = renderHook(() => useChatStore());
        stubDirectMentionRun();
        const agentId = TEST_IDS.SESSION_ID;
        const topicId = TEST_IDS.TOPIC_ID;
        const context = { agentId, threadId: null, topicId };
        const key = messageMapKey(context);
        const existingMessages = [
          createMockMessage({ id: 'existing-user', role: 'user', topicId }),
          createMockMessage({ id: 'existing-assistant', role: 'assistant', topicId }),
        ];
        const persistedUserMessage = createMockMessage({
          id: TEST_IDS.USER_MESSAGE_ID,
          role: 'user',
          topicId,
        });
        const persistedAssistantMessage = createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          role: 'assistant',
          topicId,
        });

        act(() => {
          useChatStore.setState({
            dbMessagesMap: { [key]: existingMessages },
            messagesMap: { [key]: existingMessages },
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          __isPartialMessages: true,
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: false,
          messages: [persistedUserMessage, persistedAssistantMessage],
          topicId,
          topics: undefined,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            context,
            editorData: directMentionEditorData(` ${TEST_CONTENT.USER_MESSAGE}`),
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(result.current.messagesMap[key].map((message) => message.id)).toEqual([
          'existing-user',
          'existing-assistant',
          TEST_IDS.USER_MESSAGE_ID,
          TEST_IDS.ASSISTANT_MESSAGE_ID,
        ]);
        expect(
          result.current.messagesMap[key].some((message) => message.id.startsWith('tmp_')),
        ).toBe(false);
      });

      it('should preserve editorData when enqueueing a queued message', async () => {
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);
        const onMessageAccepted = vi.fn();
        const onMessagePersisted = vi.fn();
        const editorData = {
          root: {
            children: [
              {
                children: [
                  {
                    actionCategory: 'tool',
                    actionLabel: 'Notebook',
                    actionType: 'lobe-notebook',
                    type: 'action-tag',
                  },
                  { text: ' queued message', type: 'text' },
                ],
                type: 'paragraph',
              },
            ],
            type: 'root',
          },
        };

        act(() => {
          useChatStore.setState({
            operations: {
              'op-running': {
                childOperationIds: [],
                context,
                id: 'op-running',
                metadata: {},
                status: 'running',
                type: 'execAgentRuntime',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-running'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');

        await act(async () => {
          await result.current.sendMessage({
            context,
            editorData: editorData as any,
            message: 'queued message',
            onMessageAccepted,
            onMessagePersisted,
          });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({
            content: 'queued message',
            editorData,
          }),
          'op-running',
        );
        expect(onMessageAccepted).toHaveBeenCalledOnce();
        expect(onMessagePersisted).not.toHaveBeenCalled();
      });

      it('should enqueue a later text turn behind an optimistic voice upload', async () => {
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-voice-upload': {
                childOperationIds: [],
                context: { ...context, messageId: 'tmp_voice' },
                id: 'op-voice-upload',
                metadata: { startTime: Date.now() },
                status: 'running',
                type: 'uploadVoiceMessage',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-voice-upload'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: 'text after voice',
          });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({ content: 'text after voice' }),
          'op-voice-upload',
        );
      });

      it('should enqueue when an execHeterogeneousAgent op is running (CC queue mode)', async () => {
        // With Plan A, sends during a running CC turn must hit the
        // same queue path used by client mode — without this we'd spawn a
        // second `claude` process in parallel.
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-cc-running': {
                childOperationIds: [],
                context,
                id: 'op-cc-running',
                metadata: {},
                status: 'running',
                type: 'execHeterogeneousAgent',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-cc-running'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: 'follow-up during CC run',
          });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({
            content: 'follow-up during CC run',
            interruptMode: 'soft',
          }),
          'op-cc-running',
        );
      });

      it('should NOT enqueue once the run finished its visible output', async () => {
        // Regression: the enqueue check only asked `status === 'running'`, while the
        // composer flips back to Send on `visibleLoadingDone`. The answer is complete
        // on screen and the button says Send, so the next message must start a fresh
        // turn — not park in a tray the user has no reason to expect, and one that
        // never empties at all when `agent_runtime_end` is lost over a still-open WS
        // (neither the run lifecycle nor onSessionComplete's fallback fires, and the
        // queue drains on success only).
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-visible-done': {
                childOperationIds: [],
                context,
                id: 'op-visible-done',
                metadata: { visibleLoadingDone: true },
                status: 'running',
                type: 'execServerAgentRuntime',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-visible-done'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: 'follow-up after the run visibly ended',
          });
        });

        expect(enqueueMessageSpy).not.toHaveBeenCalled();
      });

      it('should NOT enqueue behind an aborting op (Stop already pressed)', async () => {
        // Stop flips the composer back to Send immediately via `isAborting`. The
        // queue drains on success only, so queueing behind an aborting run would
        // strand the message with no run left to send it.
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-aborting': {
                childOperationIds: [],
                context,
                id: 'op-aborting',
                metadata: { isAborting: true },
                status: 'running',
                type: 'execServerAgentRuntime',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-aborting'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');

        await act(async () => {
          await result.current.sendMessage({ context, message: 'send after stop' });
        });

        expect(enqueueMessageSpy).not.toHaveBeenCalled();
      });

      it('should restart the existing queue in FIFO order when Stop already cancelled its owner', async () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-cancelled': {
                childOperationIds: [],
                context,
                id: 'op-cancelled',
                metadata: { isAborting: true },
                status: 'cancelled',
                type: 'execServerAgentRuntime',
              },
            } as any,
            operationsByContext: { [contextKey]: ['op-cancelled'] },
            queuedMessages: {
              [contextKey]: [
                {
                  content: 'queued A',
                  createdAt: Date.now(),
                  id: 'queued-1',
                  interruptMode: 'soft',
                },
              ],
            },
          });
        });

        const sendMessageSpy = vi.spyOn(result.current, 'sendMessage');

        await act(async () => {
          await result.current.sendMessage({ context, message: 'new B' });
          await vi.runAllTimersAsync();
        });

        expect(sendMessageSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ message: expect.stringMatching(/queued A[\s\S]*new B/) }),
        );
        expect(useChatStore.getState().queuedMessages[contextKey]).toEqual([]);
        vi.useRealTimers();
      });

      it('should still enqueue past visible end when follow-ups are already queued', async () => {
        // Order beats latency: those queued items belong to the terminal drain, so a
        // newer send must join the queue instead of jumping it — otherwise the drain
        // fires a second, older turn right behind this one.
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-finishing': {
                childOperationIds: [],
                context,
                id: 'op-finishing',
                metadata: { visibleLoadingDone: true },
                status: 'running',
                type: 'execServerAgentRuntime',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-finishing'],
            },
            queuedMessages: {
              [contextKey]: [
                {
                  content: 'queued before the visible end',
                  createdAt: Date.now(),
                  id: 'queued-1',
                  interruptMode: 'soft',
                },
              ],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');

        await act(async () => {
          await result.current.sendMessage({ context, message: 'follow-up mid-terminal' });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({ content: 'follow-up mid-terminal' }),
          'op-finishing',
        );
      });

      it('should enqueue behind a running interim approve/retry op (preflight window)', async () => {
        // Interim ops (approve/submit/skip/regenerate) show input loading the
        // instant the user clicks, but the real runtime op is only created 2–4
        // tRPC round-trips later. A fast follow-up Enter in that window must
        // queue behind the interim op — not fire a concurrent sendMessage that
        // interleaves with the approve/retry flow. Guards QUEUE_BLOCKING staying
        // in sync with INPUT_LOADING for INTERIM_LOADING_OPERATION_TYPES.
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-regenerate': {
                childOperationIds: [],
                context,
                id: 'op-regenerate',
                metadata: {},
                status: 'running',
                type: 'regenerate',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-regenerate'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');
        const sendMessageInServerSpy = vi.spyOn(aiChatService, 'sendMessageInServer');

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: 'follow-up during regenerate preflight',
          });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({
            content: 'follow-up during regenerate preflight',
            interruptMode: 'soft',
          }),
          'op-regenerate',
        );
        // Must queue, not start a concurrent send.
        expect(sendMessageInServerSpy).not.toHaveBeenCalled();
      });

      it('should enqueue while the first new-topic message is still being persisted', async () => {
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-send-running': {
                childOperationIds: [],
                context: { ...context, messageId: 'tmp-first-user-message' },
                id: 'op-send-running',
                metadata: {},
                status: 'running',
                type: 'sendMessage',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-send-running'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');
        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            isCreateNewTopic: true,
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topicId: TEST_IDS.TOPIC_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: 'fast follow-up before topic is created',
          });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({
            content: 'fast follow-up before topic is created',
            interruptMode: 'soft',
          }),
          'op-send-running',
        );
        expect(sendMessageInServerSpy).not.toHaveBeenCalled();
      });
    });

    describe('page scope documentId injection', () => {
      it('enables the task tool for a /goal gateway turn', async () => {
        const { result } = renderHook(() => useChatStore());
        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'op-goal',
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
            context: createTestContext(),
            message: '/goal ship the homepage',
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({ selectedToolIds: ['lobe-goal'] }),
        );
      });

      it('injects the active page documentId into the gateway context when scope is page', async () => {
        const { result } = renderHook(() => useChatStore());

        const getCurrentDocIdSpy = vi
          .spyOn(pageAgentRuntime, 'getCurrentDocId')
          .mockReturnValue('doc-page-1');

        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'op-1',
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
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              agentId: TEST_IDS.SESSION_ID,
              scope: 'page',
              threadId: null,
              topicId: null,
            },
          });
        });

        expect(getCurrentDocIdSpy).toHaveBeenCalled();
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({ documentId: 'doc-page-1', scope: 'page' }),
          }),
        );
      });

      it('does not inject documentId for non-page scope conversations', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.spyOn(pageAgentRuntime, 'getCurrentDocId').mockReturnValue('doc-page-1');

        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'op-1',
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
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.not.objectContaining({ documentId: expect.anything() }),
          }),
        );
      });
    });

    describe('group chat supervisor metadata', () => {
      it('should pass isSupervisor metadata when agentId matches supervisorAgentId', async () => {
        const { result } = renderHook(() => useChatStore());

        // Mock agentGroup store to return a group with specific supervisorAgentId
        vi.spyOn(agentGroupStore, 'getChatGroupStoreState').mockReturnValue({
          groupMap: {
            'test-group-id': {
              id: 'test-group-id',
              supervisorAgentId: 'supervisor-agent-id',
            },
          },
        } as any);

        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              agentId: 'supervisor-agent-id',
              groupId: 'test-group-id',
              topicId: null,
              threadId: null,
            },
          });
        });

        // Should pass isSupervisor metadata when agentId matches supervisorAgentId
        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              groupId: 'test-group-id',
              isSupervisor: true,
              orchestrationRole: 'supervisor',
            }),
          }),
        );
      });

      it('should NOT pass isSupervisor metadata when agentId is a sub-agent (not supervisor)', async () => {
        const { result } = renderHook(() => useChatStore());

        // Mock agentGroup store - sub-agent-id does NOT match supervisorAgentId
        vi.spyOn(agentGroupStore, 'getChatGroupStoreState').mockReturnValue({
          groupMap: {
            'test-group-id': {
              id: 'test-group-id',
              supervisorAgentId: 'supervisor-agent-id', // Different from sub-agent-id
            },
          },
        } as any);

        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              agentId: 'sub-agent-id',
              groupId: 'test-group-id',
              topicId: 'topic-id',
              threadId: 'thread-id',
            },
          });
        });

        // Should NOT pass isSupervisor metadata since agentId doesn't match supervisorAgentId
        expect(executeGatewayAgent).toHaveBeenCalledOnce();
        const gatewayContext = executeGatewayAgent.mock.calls[0][0].context;
        expect(gatewayContext.groupId).toBe('test-group-id');
        expect(gatewayContext.isSupervisor).toBeUndefined();
        expect(gatewayContext.orchestrationRole).toBeUndefined();
      });

      it('should pass isSupervisor metadata when isSupervisor is explicitly set in context', async () => {
        const { result } = renderHook(() => useChatStore());

        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              agentId: 'supervisor-agent-id',
              isSupervisor: true,
              topicId: null,
              threadId: null,
            },
          });
        });

        // Should pass isSupervisor metadata when explicitly set in context
        expect(executeGatewayAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({ isSupervisor: true }),
          }),
        );
      });

      it('should NOT pass isSupervisor metadata for regular agent chat (no groupId)', async () => {
        const { result } = renderHook(() => useChatStore());

        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        // Should NOT pass isSupervisor metadata for regular agent chat
        expect(executeGatewayAgent).toHaveBeenCalledOnce();
        const gatewayContext = executeGatewayAgent.mock.calls[0][0].context;
        expect(gatewayContext.isSupervisor).toBeUndefined();
        expect(gatewayContext.orchestrationRole).toBeUndefined();
      });

      it('should not persist the requested model for heterogeneous agents before the CLI reports it', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
            model: 'claude-sonnet-4-6',
          },
        });

        const { result } = renderHook(() => useChatStore());

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topicId: TEST_IDS.TOPIC_ID,
            topics: [],
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            // Exact object on purpose: `model` must still be absent. `id` is the
            // client-minted message id the server is asked to honour.
            newAssistantMessage: {
              id: expect.stringMatching(/^msg_/),
              provider: 'codex',
            },
          }),
          expect.any(AbortController),
        );
        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            newTopic: expect.objectContaining({ model: 'default', provider: 'codex' }),
          }),
          expect.any(AbortController),
        );
      });

      it('overrides the heterogeneous runtime with the active topic model', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: {
                args: ['--model', 'global-model', '--mode', 'plan'],
                model: 'global-model',
                type: 'cursor',
              },
            },
          },
        });
        const context = {
          agentId: TEST_IDS.SESSION_ID,
          threadId: null,
          topicId: TEST_IDS.TOPIC_ID,
        };
        const topicKey = topicMapKey({ agentId: TEST_IDS.SESSION_ID });
        act(() => {
          useChatStore.setState({
            activeAgentId: TEST_IDS.SESSION_ID,
            activeTopicId: TEST_IDS.TOPIC_ID,
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                items: [
                  {
                    createdAt: Date.now(),
                    id: TEST_IDS.TOPIC_ID,
                    model: 'topic-model',
                    provider: 'cursor',
                    title: 'Topic A',
                    updatedAt: Date.now(),
                  },
                ],
                pageSize: 20,
                total: 1,
              },
            },
          });
        });
        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(executeHeterogeneousAgentMock).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({
            heterogeneousProvider: {
              args: ['--mode', 'plan'],
              model: 'topic-model',
              type: 'cursor',
            },
          }),
        );
      });

      it('routes a legacy bare Qoder model to the desktop heterogeneous runtime without gateway mode', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({ agentConfig: { agencyConfig: undefined, model: 'qoder' } });

        const executeGatewayAgent = vi.fn();
        act(() => {
          useChatStore.setState({
            executeGatewayAgent,
            isGatewayModeEnabled: () => false,
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeHeterogeneousAgentMock).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({ heterogeneousProvider: { type: 'qoder' } }),
        );
        expect(executeGatewayAgent).not.toHaveBeenCalled();
      });

      it('keeps a legacy bare Qoder model on the gateway when gateway mode is available', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({ agentConfig: { agencyConfig: undefined, model: 'qoder' } });

        const executeGatewayAgent = vi.fn().mockImplementation(async (params) => {
          useChatStore.getState().completeOperation(params.parentOperationId);
          return {
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            operationId: 'gateway-operation',
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          };
        });
        act(() => {
          useChatStore.setState({
            executeGatewayAgent,
            isGatewayModeEnabled: () => true,
          });
        });

        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledTimes(1);
        expect(executeHeterogeneousAgentMock).not.toHaveBeenCalled();
      });

      it('routes Android Codex device execution to the gateway instead of the Provider API', async () => {
        // Regression: Android (isDesktop=false) selected a remote macOS device
        // for a Codex agent whose agencyConfig only carried the legacy
        // `model: 'codex'` identity. Without recovering the hetero provider,
        // selectRuntimeType fell through to `client` and POST /webapi/chat/codex
        // returned InvalidProviderAPIKey.
        mockConstEnv.isDesktop = false;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: 'macos-device',
              executionTarget: 'device',
            },
            model: 'codex',
          },
        });

        const executeGatewayAgent = vi.fn().mockImplementation(async (params) => {
          useChatStore.getState().completeOperation(params.parentOperationId);
          return {
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            operationId: 'gateway-operation',
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          };
        });
        act(() => {
          useChatStore.setState({
            executeGatewayAgent,
            isGatewayModeEnabled: () => false,
          });
        });

        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledTimes(1);
        expect(executeHeterogeneousAgentMock).not.toHaveBeenCalled();
      });

      it('routes Android Codex with a configured heterogeneousProvider to the gateway', async () => {
        mockConstEnv.isDesktop = false;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: 'macos-device',
              executionTarget: 'device',
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
            model: 'codex',
          },
        });

        const executeGatewayAgent = vi.fn().mockImplementation(async (params) => {
          useChatStore.getState().completeOperation(params.parentOperationId);
          return {
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            operationId: 'gateway-operation',
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          };
        });
        act(() => {
          useChatStore.setState({
            executeGatewayAgent,
            isGatewayModeEnabled: () => false,
          });
        });

        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledTimes(1);
        expect(executeHeterogeneousAgentMock).not.toHaveBeenCalled();
      });

      it('runs a workspace Codex local-device override in the desktop heterogeneous runtime', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: 'workspace-device',
              executionTarget: 'device',
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const { agentByIdSelectors } = await import('@/store/agent/selectors');
        vi.spyOn(agentByIdSelectors, 'getAgentById').mockReturnValue(
          () => ({ visibility: 'public', workspaceId: 'workspace-1' }) as any,
        );
        useUserStore.setState({
          workspaceUserPreference: {
            agentDeviceOverrides: {
              [TEST_IDS.SESSION_ID]: {
                boundDeviceId: 'personal-device',
                executionTarget: 'local',
              },
            },
          },
        });

        const executeGatewayAgent = vi.fn();
        act(() => {
          useChatStore.setState({ executeGatewayAgent });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeHeterogeneousAgentMock).toHaveBeenCalledTimes(1);
        expect(executeGatewayAgent).not.toHaveBeenCalled();
      });

      it('keeps a workspace shared-local fallback on the gateway without a member override', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: 'workspace-device',
              executionTarget: 'local',
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const { agentByIdSelectors } = await import('@/store/agent/selectors');
        vi.spyOn(agentByIdSelectors, 'getAgentById').mockReturnValue(
          () => ({ visibility: 'public', workspaceId: 'workspace-1' }) as any,
        );

        const executeGatewayAgent = vi.fn().mockResolvedValue(undefined);
        act(() => {
          useChatStore.setState({ executeGatewayAgent });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgent).toHaveBeenCalledTimes(1);
        expect(executeHeterogeneousAgentMock).not.toHaveBeenCalled();
      });

      // The owner's own `local` pick lives in the per-user override even on a
      // private Workspace Agent (the shared row must never reference a
      // personal device — the server rejects it), so a `local` override must
      // keep routing the owner's run to the in-process desktop runtime.
      it("applies the owner's own local override for a private Workspace Agent", async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: 'shared-workspace-device',
              executionTarget: 'device',
              executionTargetSelectionPolicy: 'fixed',
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
          agentMeta: { visibility: 'private', workspaceId: 'workspace-1' },
        });
        useUserStore.setState({
          workspaceUserPreference: {
            agentDeviceOverrides: {
              [TEST_IDS.SESSION_ID]: {
                boundDeviceId: 'owner-desktop',
                executionTarget: 'local',
              },
            },
          },
        });

        const executeGatewayAgent = vi.fn().mockResolvedValue(undefined);
        act(() => {
          useChatStore.setState({ executeGatewayAgent });
        });
        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeHeterogeneousAgentMock).toHaveBeenCalledTimes(1);
        expect(executeGatewayAgent).not.toHaveBeenCalled();
      });

      // A workspace admin who is not the author can store a personal `local`
      // override (the picker and server both recognize management access), and
      // runtime resolution must honor it even under a `fixed` selection
      // policy — otherwise the send silently routes to the gateway instead of
      // the admin's own desktop.
      it("applies a workspace admin's local override under a fixed selection policy", async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: 'shared-workspace-device',
              executionTarget: 'device',
              executionTargetSelectionPolicy: 'fixed',
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });
        const { agentByIdSelectors } = await import('@/store/agent/selectors');
        vi.spyOn(agentByIdSelectors, 'getAgentById').mockReturnValue(
          () =>
            ({ userId: 'author-user', visibility: 'public', workspaceId: 'workspace-1' }) as any,
        );
        const { rememberAgentManagementAccess, clearAgentManagementAccessCache } =
          await import('@/helpers/agentManagementAccess');
        useUserStore.setState({
          user: { id: 'admin-user' } as any,
          workspaceUserPreference: {
            agentDeviceOverrides: {
              [TEST_IDS.SESSION_ID]: {
                boundDeviceId: 'admin-desktop',
                executionTarget: 'local',
              },
            },
          },
        });
        rememberAgentManagementAccess('admin-user', TEST_IDS.SESSION_ID, true);

        const executeGatewayAgent = vi.fn().mockResolvedValue(undefined);
        act(() => {
          useChatStore.setState({ executeGatewayAgent });
        });
        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        try {
          const { result } = renderHook(() => useChatStore());
          await act(async () => {
            await result.current.sendMessage({
              message: TEST_CONTENT.USER_MESSAGE,
              context: createTestContext(),
            });
          });

          expect(executeHeterogeneousAgentMock).toHaveBeenCalledTimes(1);
          expect(executeGatewayAgent).not.toHaveBeenCalled();
        } finally {
          clearAgentManagementAccessCache();
          useUserStore.setState({ user: undefined as any });
        }
      });

      // Same scenario on a COLD cache: the picker's hook never ran, so the
      // send path must resolve management access from the server itself
      // before choosing a runtime.
      it("resolves an unprimed admin's access from the server before dispatch", async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              boundDeviceId: 'shared-workspace-device',
              executionTarget: 'device',
              executionTargetSelectionPolicy: 'fixed',
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });
        const { agentByIdSelectors } = await import('@/store/agent/selectors');
        vi.spyOn(agentByIdSelectors, 'getAgentById').mockReturnValue(
          () =>
            ({ userId: 'author-user', visibility: 'public', workspaceId: 'workspace-1' }) as any,
        );
        const { clearAgentManagementAccessCache } = await import('@/helpers/agentManagementAccess');
        clearAgentManagementAccessCache();
        getGeneralAccessMock.mockResolvedValue({ canManage: true });
        useUserStore.setState({
          user: { id: 'admin-user' } as any,
          workspaceUserPreference: {
            agentDeviceOverrides: {
              [TEST_IDS.SESSION_ID]: {
                boundDeviceId: 'admin-desktop',
                executionTarget: 'local',
              },
            },
          },
        });

        const executeGatewayAgent = vi.fn().mockResolvedValue(undefined);
        act(() => {
          useChatStore.setState({ executeGatewayAgent });
        });
        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        try {
          const { result } = renderHook(() => useChatStore());
          await act(async () => {
            await result.current.sendMessage({
              message: TEST_CONTENT.USER_MESSAGE,
              context: createTestContext(),
            });
          });

          expect(getGeneralAccessMock).toHaveBeenCalledWith('agent', TEST_IDS.SESSION_ID);
          expect(executeHeterogeneousAgentMock).toHaveBeenCalledTimes(1);
          expect(executeGatewayAgent).not.toHaveBeenCalled();
        } finally {
          clearAgentManagementAccessCache();
          getGeneralAccessMock.mockReset();
          useUserStore.setState({ user: undefined as any });
        }
      });

      it('should route new-topic heterogeneous streaming updates to the persisted topic key', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const createdTopicId = 'created-topic-id';
        const { result } = renderHook(() => useChatStore());

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: true,
          messages: [
            createMockMessage({
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              topicId: createdTopicId,
            }),
            createMockMessage({
              id: TEST_IDS.ASSISTANT_MESSAGE_ID,
              role: 'assistant',
              topicId: createdTopicId,
            }),
          ],
          topicId: createdTopicId,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: { ...createTestContext(), isNew: true, scope: 'main' },
          });
        });

        const executorParams = executeHeterogeneousAgentMock.mock.calls[0]?.[1];
        expect(executorParams?.context).toEqual(
          expect.objectContaining({
            agentId: TEST_IDS.SESSION_ID,
            isNew: false,
            scope: 'main',
            topicId: createdTopicId,
          }),
        );

        const heteroOperation = Object.values(useChatStore.getState().operations).find(
          (operation) => operation.type === 'execHeterogeneousAgent',
        );
        expect(heteroOperation?.context).toEqual(
          expect.objectContaining({
            isNew: false,
            topicId: createdTopicId,
          }),
        );

        const persistedTopicKey = messageMapKey({
          agentId: TEST_IDS.SESSION_ID,
          scope: 'main',
          topicId: createdTopicId,
        });
        const leakedNewTopicKey = messageMapKey({
          agentId: TEST_IDS.SESSION_ID,
          isNew: true,
          scope: 'main',
          topicId: createdTopicId,
        });

        expect(useChatStore.getState().messagesMap[persistedTopicKey]).toHaveLength(2);
        expect(useChatStore.getState().messagesMap[leakedNewTopicKey] ?? []).toHaveLength(0);
      });

      it('reconciles a persisted heterogeneous message but skips CLI execution after cancellation', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });
        const { result } = renderHook(() => useChatStore());
        const controller = new AbortController();
        const onMessageAccepted = vi.fn();
        const onMessagePersisted = vi.fn();
        let resolvePersistence!: (value: any) => void;
        const persistence = new Promise<any>((resolve) => {
          resolvePersistence = resolve;
        });
        const sendMessageInServer = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockReturnValue(persistence);
        const context = {
          agentId: TEST_IDS.SESSION_ID,
          threadId: null,
          topicId: TEST_IDS.TOPIC_ID,
        };

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context,
            message: TEST_CONTENT.USER_MESSAGE,
            onMessageAccepted,
            onMessagePersisted,
            signal: controller.signal,
          });
        });
        await waitFor(() => expect(sendMessageInServer).toHaveBeenCalledOnce());

        act(() => controller.abort(new DOMException('cancelled', 'AbortError')));
        await act(async () => {
          resolvePersistence({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [
              createMockMessage({
                id: TEST_IDS.USER_MESSAGE_ID,
                role: 'user',
                topicId: TEST_IDS.TOPIC_ID,
              }),
              createMockMessage({
                id: TEST_IDS.ASSISTANT_MESSAGE_ID,
                role: 'assistant',
                topicId: TEST_IDS.TOPIC_ID,
              }),
            ],
            topicId: TEST_IDS.TOPIC_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          });
          await sendPromise;
        });

        expect(onMessageAccepted).toHaveBeenCalledOnce();
        expect(onMessagePersisted).toHaveBeenCalledOnce();
        expect(executeHeterogeneousAgentMock).not.toHaveBeenCalled();
        expect(result.current.messagesMap[messageMapKey(context)]).toHaveLength(2);
      });

      it('should preserve the isNew marker for heterogeneous new-thread contexts', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const { result } = renderHook(() => useChatStore());

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              ...createTestContext(),
              isNew: true,
              scope: 'thread',
              sourceMessageId: 'source-message-id',
              threadType: 'continuation',
              topicId: TEST_IDS.TOPIC_ID,
            },
          });
        });

        const executorParams = executeHeterogeneousAgentMock.mock.calls[0]?.[1];
        expect(executorParams?.context).toEqual(
          expect.objectContaining({
            isNew: true,
            scope: 'thread',
            topicId: TEST_IDS.TOPIC_ID,
          }),
        );
      });

      it('should recover heterogeneous context selections from the persisted user message metadata', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const persistedContextSelections = [
          {
            content: 'const selected = true;',
            filePath: 'src/example.ts',
            id: 'code-selection',
            lineRange: { endLine: 12, startLine: 10 },
            source: 'code' as const,
          },
        ];
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({
              id: TEST_IDS.USER_MESSAGE_ID,
              metadata: { contextSelections: persistedContextSelections },
              role: 'user',
            }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: [],
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeHeterogeneousAgentMock).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({
            contextSelections: persistedContextSelections,
          }),
        );
      });

      it('should materialize local file mention editor data into persisted tool-result snapshots', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });
        mockLocalFileService.readLocalFile.mockResolvedValue({
          charCount: 17,
          content: 'export const x = 1;',
          fileType: 'text',
          filename: 'foo.ts',
          loc: [0, 200],
          totalCharCount: 17,
          totalLineCount: 1,
        });

        const { result } = renderHook(() => useChatStore());
        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topicId: TEST_IDS.TOPIC_ID,
            topics: [],
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'foo.ts',
                        metadata: {
                          name: 'foo.ts',
                          path: '/Users/me/project/foo.ts',
                          type: 'localFile',
                        },
                        type: 'mention',
                      },
                      { text: ' 这个文件是什么', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            },
            message: '<localFile name="foo.ts" path="/Users/me/project/foo.ts" /> 这个文件是什么',
          });
        });

        expect(mockLocalFileService.readLocalFile).toHaveBeenCalledWith({
          path: '/Users/me/project/foo.ts',
        });
        const payload = sendMessageInServerSpy.mock.calls[0]?.[0];
        expect(payload?.newUserMessage.metadata?.localSystemToolSnapshots).toMatchObject([
          {
            apiName: 'readFile',
            arguments: { path: '/Users/me/project/foo.ts' },
            content: expect.stringContaining('export const x = 1;'),
            identifier: 'lobe-local-system',
            success: true,
          },
        ]);
      });
    });

    describe('optimistic topic sortUpdatedAt', () => {
      // The client-side bump runs after the persistence response, which the
      // direct @agent route still awaits (gateway sends are server-ordered).
      it('should optimistically bump topic sortUpdatedAt when sending message to existing topic', async () => {
        const { result } = renderHook(() => useChatStore());
        stubDirectMentionRun();
        const topicId = TEST_IDS.TOPIC_ID;

        const dispatchTopicSpy = vi.spyOn(result.current, 'internal_dispatchTopic');

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user', topicId }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant', topicId }),
          ],
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            editorData: directMentionEditorData(` ${TEST_CONTENT.USER_MESSAGE}`),
            context: { agentId: TEST_IDS.SESSION_ID, topicId, threadId: null },
          });
        });

        // Should call internal_dispatchTopic with updateTopic to bump the sidebar sort key
        expect(dispatchTopicSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'updateTopic',
            id: topicId,
            value: { sortUpdatedAt: expect.any(Number) },
          }),
        );
      });

      it('should NOT optimistically bump topic sortUpdatedAt when server returns topics (new topic)', async () => {
        const { result } = renderHook(() => useChatStore());

        const dispatchTopicSpy = vi.spyOn(result.current, 'internal_dispatchTopic');

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topics: { items: [{ id: 'new-topic', title: 'New Topic' }], total: 1 },
          topicId: 'new-topic',
          isCreateNewTopic: true,
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        // Should NOT call internal_dispatchTopic with updateTopic for sortUpdatedAt
        const updateTopicCalls = dispatchTopicSpy.mock.calls.filter(
          ([payload]) => payload.type === 'updateTopic' && 'sortUpdatedAt' in (payload.value || {}),
        );
        expect(updateTopicCalls).toHaveLength(0);
      });
    });

    describe('@agent mention delegation', () => {
      it('should forward a non-leading @agent to the gateway supervisor without supervisor markers', async () => {
        const { result } = renderHook(() => useChatStore());

        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: 'hello @Agent A',
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      { text: 'hello ', type: 'text' },
                      {
                        label: 'Agent A',
                        metadata: { id: 'agent-a', type: 'agent' },
                        type: 'mention',
                      },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            // Non-group context: no groupId
            context: createTestContext(),
          });
        });

        // The mention is a delegation hint for the supervisor, not a group
        // supervisor turn: no supervisor markers on the run context.
        expect(executeGatewayAgent).toHaveBeenCalledOnce();
        const gatewayParams = executeGatewayAgent.mock.calls[0][0];
        expect(gatewayParams.context.isSupervisor).toBeUndefined();
        expect(gatewayParams.mentionedAgents).toEqual([{ id: 'agent-a', name: 'Agent A' }]);
      });

      it('should isolate a direct mention executed by a local heterogeneous agent', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });

        const targetAgentId = 'agent-direct-codex';
        const threadId = 'thread-direct-codex';
        const threadAssistantId = 'thread-assistant-codex';
        const message = '@Codex inspect this';
        const userMessage = createMockMessage({
          content: message,
          id: TEST_IDS.USER_MESSAGE_ID,
          role: 'user',
        });
        const sourceAssistant = createMockMessage({
          agentId: targetAgentId,
          content: '',
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          role: 'assistant',
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [userMessage, sourceAssistant],
          topicId: TEST_IDS.TOPIC_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);
        const createTaskSpy = vi.spyOn(aiAgentService, 'createClientTaskThread').mockResolvedValue({
          assistantMessageId: threadAssistantId,
          messages: [userMessage, sourceAssistant],
          startedAt: new Date().toISOString(),
          success: true,
          threadId,
          threadMessages: [
            createMockMessage({ id: 'thread-user-codex', role: 'user', threadId }),
            createMockMessage({ id: threadAssistantId, role: 'assistant', threadId }),
          ],
          userMessageId: 'thread-user-codex',
        } as any);
        const updateTaskSpy = vi
          .spyOn(aiAgentService, 'updateClientTaskThreadStatus')
          .mockResolvedValue({
            status: 'completed',
            success: true,
            threadId,
          } as any);
        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        const { result } = renderHook(() => useChatStore());
        const dispatchSpy = vi.spyOn(useChatStore.getState(), 'internal_dispatchMessage');
        await act(async () => {
          await result.current.sendMessage({
            context: { ...createTestContext(), topicId: TEST_IDS.TOPIC_ID },
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'Codex',
                        metadata: { id: targetAgentId, type: 'agent' },
                        type: 'mention',
                      },
                      { text: ' inspect this', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            message,
          });
        });

        expect(createTaskSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: targetAgentId,
            assistantMessage: { provider: 'codex' },
            parentMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            topicId: TEST_IDS.TOPIC_ID,
          }),
        );
        expect(executeHeterogeneousAgentMock).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({
            assistantMessageId: threadAssistantId,
            context: expect.objectContaining({
              agentId: targetAgentId,
              scope: 'sub_agent',
              subAgentId: targetAgentId,
              threadId,
            }),
          }),
        );
        expect(updateTaskSpy).toHaveBeenCalledWith(
          expect.objectContaining({ completionReason: 'done', threadId }),
        );
        expect(dispatchSpy).toHaveBeenCalledWith(
          {
            id: TEST_IDS.ASSISTANT_MESSAGE_ID,
            type: 'updateMessage',
            value: { content: TEST_CONTENT.USER_MESSAGE },
          },
          {
            context: expect.objectContaining({
              agentId: TEST_IDS.SESSION_ID,
              isNew: false,
              topicId: TEST_IDS.TOPIC_ID,
            }),
          },
        );
      });

      it('should route a single leading @agent through the gateway when gateway mode is enabled', async () => {
        const { result } = renderHook(() => useChatStore());
        const targetAgentId = 'agent-direct-target';
        const toolMessageId = 'unused-tool-call-agent-result';
        const message = '@Agent B hello';

        const userMessage = createMockMessage({
          id: TEST_IDS.USER_MESSAGE_ID,
          role: 'user',
          content: message,
        });
        let assistantMessage = createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          content: '',
          tools: [],
        });

        // A direct mention runs the target on the gateway, which owns persistence.
        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [userMessage, assistantMessage],
            topicId: TEST_IDS.TOPIC_ID,
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);
        vi.spyOn(aiAgentService, 'execSubAgentTask').mockResolvedValue({
          assistantMessageId: 'thread-assistant',
          operationId: 'op-gw-sub',
          success: true,
          threadId: 'thread-gateway',
        });
        vi.spyOn(aiAgentService, 'getSubAgentTaskStatus').mockResolvedValue({
          result: 'Gateway result',
          status: 'completed',
          taskDetail: undefined,
        } as any);

        (messageService.updateMessage as any).mockImplementation(
          async (_id: string, value: any) => {
            assistantMessage = { ...assistantMessage, ...value };
            return { messages: [userMessage, assistantMessage], success: true };
          },
        );
        (messageService.createMessage as any).mockImplementation(async (params: any) => {
          const toolMessage = createMockMessage({ ...params, id: toolMessageId, role: 'tool' });
          return { id: toolMessageId, messages: [userMessage, assistantMessage, toolMessage] };
        });

        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'op-gw-sub',
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
            message,
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'Agent B',
                        metadata: { id: targetAgentId, type: 'agent' },
                        type: 'mention',
                      },
                      { text: ' hello', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            context: { ...createTestContext(), topicId: TEST_IDS.TOPIC_ID },
          });
        });

        expect(sendMessageInServerSpy).toHaveBeenCalled();
        expect(messageService.createMessage).not.toHaveBeenCalled();
        // The TARGET agent runs as a server sub-agent, not a new gateway turn.
        expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
        expect(aiAgentService.execSubAgentTask).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: targetAgentId,
            parentMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            topicId: TEST_IDS.TOPIC_ID,
          }),
        );
      });

      it('should forward mentionedAgents to the gateway for multi-mention when gateway mode is enabled', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topics: [],
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'op-gw-supervisor',
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
            message: '@Agent A @Agent B compare',
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'Agent A',
                        metadata: { id: 'agent-a', type: 'agent' },
                        type: 'mention',
                      },
                      { text: ' ', type: 'text' },
                      {
                        label: 'Agent B',
                        metadata: { id: 'agent-b', type: 'agent' },
                        type: 'mention',
                      },
                      { text: ' compare', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            context: createTestContext(),
          });
        });

        // Multi-mention keeps the supervisor on the gateway; single-mention runs
        // the target directly. The mentioned agents are
        // forwarded so the server enables callAgent + injects the delegation context.
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            mentionedAgents: [
              { id: 'agent-a', name: 'Agent A' },
              { id: 'agent-b', name: 'Agent B' },
            ],
          }),
        );
      });

      it('should NOT forward mentionedAgents to the gateway when in group chat', async () => {
        const { result } = renderHook(() => useChatStore());

        // Mock group store so groupId resolves
        vi.spyOn(agentGroupStore, 'getChatGroupStoreState').mockReturnValue({
          groupMap: {
            'test-group': {
              id: 'test-group',
              supervisorAgentId: 'supervisor-id',
            },
          },
        } as any);

        const executeGatewayAgent = mockGatewayAgent();

        await act(async () => {
          await result.current.sendMessage({
            message: '@Agent A in group',
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'Agent A',
                        metadata: { id: 'agent-a', type: 'agent' },
                        type: 'mention',
                      },
                      { text: ' in group', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            // Group context
            context: {
              agentId: 'sub-agent-id',
              groupId: 'test-group',
              topicId: null,
              threadId: null,
            },
          });
        });

        // Group @member mentions belong to group orchestration, not agent delegation
        expect(executeGatewayAgent).toHaveBeenCalledOnce();
        expect(executeGatewayAgent.mock.calls[0][0].mentionedAgents).toBeUndefined();
      });
    });

    describe('auto-dismiss pending tool interventions', () => {
      // Auto-dismiss runs on the persisted turn of the direct @agent route.
      it('should abort pending flat tool messages when user sends a new message', async () => {
        const { result } = renderHook(() => useChatStore());
        stubDirectMentionRun();
        const agentId = TEST_IDS.SESSION_ID;
        // Pending interventions only ever live in a real topic bucket now: a
        // new-topic send adopts its minted id up front, so the `_new` bucket
        // never holds messages.
        const topicId = 'topic-pending';
        const key = messageMapKey({ agentId, topicId });

        const pendingToolMsg = createMockMessage({
          id: 'tool-pending-1',
          role: 'tool',
          content: '',
          pluginIntervention: { status: 'pending' },
          topicId,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            messagesMap: { [key]: [pendingToolMsg] },
            dbMessagesMap: { [key]: [pendingToolMsg] },
          });
        });

        const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');
        const updatePluginSpy = vi
          .spyOn(messageService, 'updateMessagePlugin')
          .mockResolvedValue({ success: true } as any);

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            pendingToolMsg,
            createMockMessage({ id: 'new-user-msg', role: 'user', topicId: undefined }),
            createMockMessage({ id: 'new-assistant-msg', role: 'assistant', topicId: undefined }),
          ],
          topics: [],
          assistantMessageId: 'new-assistant-msg',
          userMessageId: 'new-user-msg',
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: 'override pending interaction',
            editorData: directMentionEditorData(' override pending interaction'),
            context: { agentId, topicId, threadId: null },
          });
        });

        // Should dispatch a single merged update for pluginIntervention + content
        const abortCalls = dispatchSpy.mock.calls.filter(
          ([payload]) =>
            payload.type === 'updateMessage' &&
            (payload as any).value?.pluginIntervention?.status === 'aborted',
        );
        expect(abortCalls).toHaveLength(1);
        expect(abortCalls[0][0]).toEqual(
          expect.objectContaining({
            id: 'tool-pending-1',
            type: 'updateMessage',
            value: expect.objectContaining({
              pluginIntervention: { status: 'aborted' },
              content: 'User bypassed this interaction by sending a message directly.',
            }),
          }),
        );

        // Should persist intervention status to server
        expect(updatePluginSpy).toHaveBeenCalledWith(
          'tool-pending-1',
          { intervention: { status: 'aborted' } },
          expect.any(Object),
        );
      });

      it('should abort pending interventions in group message children', async () => {
        const { result } = renderHook(() => useChatStore());
        stubDirectMentionRun();
        const agentId = TEST_IDS.SESSION_ID;
        // Same shift as the flat-tool case: messages only live in real topic
        // buckets now, never in `_new`.
        const topicId = 'topic-pending';
        const key = messageMapKey({ agentId, topicId });

        const groupMsg = createMockMessage({
          id: 'group-1',
          role: 'assistant',
          topicId,
          children: [
            {
              id: 'child-1',
              content: '',
              tools: [
                {
                  apiName: 'askUserQuestion',
                  arguments: '{}',
                  id: 'tool-call-1',
                  identifier: 'lobe-user-interaction',
                  intervention: { status: 'pending' },
                  result_msg_id: 'tool-result-1',
                },
              ],
            },
          ] as any,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            messagesMap: { [key]: [groupMsg] },
            dbMessagesMap: { [key]: [groupMsg] },
          });
        });

        const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');
        vi.spyOn(messageService, 'updateMessagePlugin').mockResolvedValue({
          success: true,
        } as any);

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            groupMsg,
            createMockMessage({ id: 'new-user-msg', role: 'user', topicId: undefined }),
            createMockMessage({ id: 'new-assistant-msg', role: 'assistant', topicId: undefined }),
          ],
          topics: [],
          assistantMessageId: 'new-assistant-msg',
          userMessageId: 'new-user-msg',
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: 'override group interaction',
            editorData: directMentionEditorData(' override group interaction'),
            context: { agentId, topicId, threadId: null },
          });
        });

        // Should dispatch abort for the tool result message found in children
        const abortCalls = dispatchSpy.mock.calls.filter(
          ([payload]) =>
            payload.type === 'updateMessage' &&
            (payload as any).value?.pluginIntervention?.status === 'aborted',
        );
        expect(abortCalls).toHaveLength(1);
        expect(abortCalls[0][0]).toEqual(
          expect.objectContaining({
            id: 'tool-result-1',
            type: 'updateMessage',
            value: expect.objectContaining({
              pluginIntervention: { status: 'aborted' },
            }),
          }),
        );
      });

      it('should not dispatch if no pending interventions exist', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const key = messageMapKey({ agentId, topicId: null });

        const normalMsg = createMockMessage({
          id: 'normal-1',
          role: 'assistant',
          topicId: undefined,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            messagesMap: { [key]: [normalMsg] },
            dbMessagesMap: { [key]: [normalMsg] },
          });
        });

        const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');
        const updatePluginSpy = vi
          .spyOn(messageService, 'updateMessagePlugin')
          .mockResolvedValue({ success: true } as any);

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            normalMsg,
            createMockMessage({ id: 'new-user-msg', role: 'user', topicId: undefined }),
            createMockMessage({ id: 'new-assistant-msg', role: 'assistant', topicId: undefined }),
          ],
          topics: [],
          assistantMessageId: 'new-assistant-msg',
          userMessageId: 'new-user-msg',
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: 'normal message',
            context: { agentId, topicId: null, threadId: null },
          });
        });

        // No updateMessage dispatch for intervention abort
        const abortDispatches = dispatchSpy.mock.calls.filter(
          ([payload]) =>
            payload.type === 'updateMessage' &&
            (payload as any).value?.pluginIntervention?.status === 'aborted',
        );
        expect(abortDispatches).toHaveLength(0);
        expect(updatePluginSpy).not.toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ intervention: { status: 'aborted' } }),
          expect.any(Object),
        );
      });
    });

    describe('new topic creation cleanup', () => {
      // The direct @agent route persists the new topic itself, then switches to
      // it and drops the `_new` bucket.
      it('should clear _new key data when new topic is created', async () => {
        const { result } = renderHook(() => useChatStore());
        stubDirectMentionRun();
        const agentId = TEST_IDS.SESSION_ID;
        const newTopicId = 'created-topic-id';

        // Setup initial state: messages exist in the _new key (no topicId)
        const newKey = messageMapKey({ agentId, topicId: null });
        const existingMessages = [
          createMockMessage({ id: 'old-msg-1', role: 'user' }),
          createMockMessage({ id: 'old-msg-2', role: 'assistant' }),
        ];

        await act(async () => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            messagesMap: {
              [newKey]: existingMessages,
            },
            dbMessagesMap: {
              [newKey]: existingMessages,
            },
          });
        });

        // Verify messages exist in _new key before sending
        expect(useChatStore.getState().messagesMap[newKey]).toHaveLength(2);

        // Mock server response with new topic creation
        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            createMockMessage({ id: 'new-user-msg', role: 'user', topicId: newTopicId }),
            createMockMessage({ id: 'new-assistant-msg', role: 'assistant', topicId: newTopicId }),
          ],
          topicId: newTopicId,
          isCreateNewTopic: true,
          assistantMessageId: 'new-assistant-msg',
          userMessageId: 'new-user-msg',
        } as any);

        // Mock switchTopic to verify it's called correctly
        const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            editorData: directMentionEditorData(` ${TEST_CONTENT.USER_MESSAGE}`),
            context: { agentId, topicId: null, threadId: null },
          });
        });

        // switchTopic should be called with the new topicId and clearNewKey option
        expect(switchTopicSpy).toHaveBeenCalledWith(
          newTopicId,
          expect.objectContaining({
            clearNewKey: true,
            skipRefreshMessage: true,
          }),
        );

        // After new topic creation, the _new key should be cleared
        const messagesInNewKey = useChatStore.getState().messagesMap[newKey];
        expect(messagesInNewKey ?? []).toHaveLength(0);

        const newTopicKey = messageMapKey({ agentId, topicId: newTopicId });
        expect(useChatStore.getState().messagesMap[newTopicKey]).toHaveLength(2);
        expect(useChatStore.getState().topicDataMap[topicMapKey({ agentId })]?.items[0]).toEqual(
          expect.objectContaining({ id: newTopicId }),
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Characterization net for the POST-PERSIST topic-title auto-generation hook.
  //
  // Once `executeGatewayAgent` reports the persisted topic, sendMessage fires a
  // fire-and-forget `afterUserMessagePersisted`, which calls
  // `summaryTopicTitle(topicId, messages)` when the gate is met:
  //   - the send created the topic          → always summarize the new topic, OR
  //   - existing topic whose `title` is empty/falsy → summarize it.
  // These tests lock the WIRING from sendMessage, not the title generation
  // mechanism itself (that's unit-tested in topic/action.test.ts and
  // lifecycle/buildRunLifecycle.test.ts).
  //
  // NOTE on async: the hook is dispatched WITHOUT await inside sendMessage.
  // Because the spy resolves synchronously and `act(async () => await ...)` flushes
  // the microtask queue, asserting on the spy right after the awaited sendMessage
  // is reliable here.
  // ───────────────────────────────────────────────────────────────────────────
  describe('post-persist title auto-gen characterization (lifecycle refactor regression net)', () => {
    it('GATEWAY new-topic path: summaryTopicTitle IS invoked with the created topicId', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = TEST_IDS.SESSION_ID;

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);
      act(() => {
        useChatStore.setState({ summaryTopicTitle: summaryTopicTitleSpy });
      });
      const executeGatewayAgent = mockGatewayAgent();

      await act(async () => {
        await result.current.sendMessage({
          context: { agentId, threadId: null, topicId: null },
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      const createdTopicId = executeGatewayAgent.mock.calls[0][0].clientIds.topicId;
      expect(createdTopicId).toMatch(/^tpc_/);
      // new-topic gate → summarize the freshly created topic.
      expect(summaryTopicTitleSpy).toHaveBeenCalledTimes(1);
      expect(summaryTopicTitleSpy).toHaveBeenCalledWith(createdTopicId, expect.any(Array));
    });

    it('GATEWAY existing-topic with EMPTY title: summaryTopicTitle IS invoked', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);

      // Seed an existing topic whose title is empty — this is the second gate branch.
      // currentTopicData() keys on activeAgentId, which resetTestEnvironment set to SESSION_ID.
      act(() => {
        useChatStore.setState({
          summaryTopicTitle: summaryTopicTitleSpy,
          topicDataMap: {
            [topicMapKey({ agentId })]: {
              items: [{ id: topicId, title: '' }],
              total: 1,
            },
          } as any,
        });
      });
      mockGatewayAgent();

      await act(async () => {
        await result.current.sendMessage({
          context: { agentId, threadId: null, topicId },
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      // empty-title gate → summarize the existing topic.
      expect(summaryTopicTitleSpy).toHaveBeenCalledTimes(1);
      expect(summaryTopicTitleSpy.mock.calls[0][0]).toBe(topicId);
    });

    it('GATEWAY existing-topic that ALREADY has a title: summaryTopicTitle is NOT invoked (gate not met)', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);

      // Existing topic WITH a non-empty title → neither gate branch fires.
      act(() => {
        useChatStore.setState({
          summaryTopicTitle: summaryTopicTitleSpy,
          topicDataMap: {
            [topicMapKey({ agentId })]: {
              items: [{ id: topicId, title: 'Already has a title' }],
              total: 1,
            },
          } as any,
        });
      });
      const executeGatewayAgent = mockGatewayAgent();

      await act(async () => {
        await result.current.sendMessage({
          context: { agentId, threadId: null, topicId },
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      expect(executeGatewayAgent).toHaveBeenCalledOnce();
      expect(summaryTopicTitleSpy).not.toHaveBeenCalled();
    });

    it('GATEWAY path without a persisted topicId: summaryTopicTitle is NOT invoked', async () => {
      // When the gateway run reports no topic (the server never persisted one),
      // there is nothing to title: the hook must not fire on the optimistic id.
      const { result } = renderHook(() => useChatStore());

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);
      const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        operationId: 'op-gateway',
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });

      act(() => {
        useChatStore.setState({
          executeGatewayAgent: executeGatewayAgentSpy,
          isGatewayModeEnabled: () => true,
          summaryTopicTitle: summaryTopicTitleSpy,
        });
      });

      await act(async () => {
        await result.current.sendMessage({
          context: createTestContext(),
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      // gateway routing was actually taken (precondition for the assertion below)
      expect(executeGatewayAgentSpy).toHaveBeenCalled();
      // and the client-side post-persist title hook was NOT reached
      expect(summaryTopicTitleSpy).not.toHaveBeenCalled();
    });
  });
});
