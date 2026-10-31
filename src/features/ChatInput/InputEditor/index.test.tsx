import { RequestTrigger } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InputEditor from './index';

const permission = vi.hoisted(() => ({
  allowed: false,
}));

const platform = vi.hoisted(() => ({
  isMobile: false,
}));

const mocks = vi.hoisted(() => {
  const chatInputState = {
    clearInputCompletionError: vi.fn(() => {
      chatInputState.inputCompletionError = undefined;
      chatInputState.inputCompletionErrorDismissed = false;
    }),
    dismissInputCompletionError: vi.fn(() => {
      chatInputState.inputCompletionErrorDismissed = true;
    }),
    getMessages: vi.fn(() => []),
    inputCompletionError: undefined as { errorType?: string; message: string } | undefined,
    inputCompletionErrorDismissed: false,
    pauseInputCompletion: vi.fn((error: { message: string }) => {
      chatInputState.inputCompletionError = error;
      chatInputState.inputCompletionErrorDismissed = false;
    }),
  };

  return {
    activeWorkspaceId: null as string | null,
    chainInputCompletion: vi.fn(),
    chatInputState,
    defaultInputCompletionConfig: {
      enabled: false,
      model: 'glm-5.3-flash',
      provider: 'lobehub',
    },
    generateJSON: vi.fn(),
    inputCompletionConfig: {
      enabled: false,
      model: 'gpt-4o-mini',
      provider: 'openai',
    },
    recordTracingFeedback: vi.fn(),
  };
});

type StoreSelector<T = unknown> = (state: Record<PropertyKey, unknown>) => T;

type AutoCompleteProps = {
  onAutoComplete: (params: {
    abortSignal: AbortSignal;
    afterText: string;
    input: string;
    suggestionId: string;
  }) => Promise<string | null>;
};

const getAutoCompleteProps = async (): Promise<AutoCompleteProps> => {
  const { ReactAutoCompletePlugin } = await import('@lobehub/editor');
  const { Editor } = await import('@lobehub/editor/react');
  const autoCompleteCall = vi
    .mocked(Editor.withProps)
    .mock.calls.find(([plugin]) => plugin === ReactAutoCompletePlugin);
  const autoCompleteProps = autoCompleteCall?.[1] as AutoCompleteProps | undefined;

  expect(autoCompleteProps).toBeDefined();

  return autoCompleteProps!;
};

const getEditorStyle = async () => {
  const { Editor } = await import('@lobehub/editor/react');
  const props = vi.mocked(Editor).mock.lastCall?.[0] as
    { style?: { fontSize?: number } } | undefined;

  expect(props).toBeDefined();

  return props!.style;
};

vi.mock('@lobechat/const', () => ({
  isDesktop: false,
  TRACING_SCENARIOS: { InputCompletion: 'input_completion' },
}));
vi.mock('@lobechat/const/hotkeys', () => ({
  HotkeyEnum: { AddUserMessage: 'add-user-message' },
  KeyEnum: { Alt: 'alt', Enter: 'enter' },
}));
vi.mock('@lobechat/heterogeneous-agents', () => ({ HETEROGENEOUS_TYPE_LABELS: {} }));
vi.mock('@lobechat/prompts', () => ({
  chainInputCompletion: mocks.chainInputCompletion,
  escapeXmlAttr: (value: string) => value,
  INPUT_COMPLETION_PROMPT_VERSION: 'v1',
  INPUT_COMPLETION_SCHEMA_NAME: 'InputCompletion',
}));
vi.mock('@lobechat/utils', () => ({
  isRecord: (value: unknown): value is Record<PropertyKey, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  isCommandPressed: vi.fn(() => false),
  merge: vi.fn((...args) => Object.assign({}, ...args)),
}));
vi.mock('@lobehub/editor', () => ({
  INSERT_MENTION_COMMAND: 'insert-mention',
  ReactAutoCompletePlugin: vi.fn(),
  ReactMathPlugin: vi.fn(),
}));
vi.mock('@lobehub/editor/react', () => {
  const Editor = Object.assign(
    vi.fn(({ content, editable }: { content?: string; editable?: boolean }) => (
      <div data-content={content} data-editable={String(editable)} data-testid="mock-editor" />
    )),
    {
      withProps: vi.fn((plugin, props) => [plugin, props]),
    },
  );

  return {
    Editor,
    useEditorState: vi.fn(() => ({ isEmpty: true })),
  };
});
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  combineKeys: vi.fn(() => 'alt+enter'),
}));
vi.mock('fuse.js', () => ({
  default: class Fuse {
    search() {
      return [];
    }
  },
}));
vi.mock('lexical', () => ({ KEY_ESCAPE_COMMAND: 'escape' }));
vi.mock('react-hotkeys-hook', () => ({
  useHotkeysContext: () => ({
    disableScope: vi.fn(),
    enableScope: vi.fn(),
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => mocks.activeWorkspaceId,
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));
vi.mock('@/components/DragUploadZone', () => ({
  usePasteFile: vi.fn(),
  useUploadFiles: () => ({ handleUploadFiles: vi.fn() }),
}));
vi.mock('@/hooks/useEnterToSend', () => ({ useEnterToSend: () => vi.fn(() => false) }));
vi.mock('@/hooks/useIMECompositionEvent', () => ({
  useIMECompositionEvent: () => ({
    compositionProps: {
      onCompositionEnd: vi.fn(),
      onCompositionStart: vi.fn(),
    },
    isComposingRef: { current: false },
  }),
}));
vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: permission.allowed, reason: '' }),
}));
vi.mock('@/services/chat', () => ({ chatService: { fetchPresetTaskResult: vi.fn() } }));
vi.mock('@/services/aiChat', () => ({
  aiChatService: {
    generateJSON: mocks.generateJSON,
    recordTracingFeedback: mocks.recordTracingFeedback,
  },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    <T,>(selector: StoreSelector<T>) => selector({ useFetchTopicDetail: () => {} }),
    {
      getState: () => ({ activeTopicId: undefined }),
    },
  ),
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: <T,>(selector: StoreSelector<T>) =>
    selector({ isMobile: platform.isMobile }),
}));
vi.mock('../hooks/useChatInputDraft', () => ({
  useChatInputDraft: () => ({ restoreDraft: vi.fn(), saveDraftDebounced: vi.fn() }),
}));
vi.mock('../hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canUseResource: true, isGroupContext: false }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: <T,>(selector: StoreSelector<T>) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => undefined,
    getAgentModelById: () => () => undefined,
    getAgentModelProviderById: () => () => undefined,
  },
}));
vi.mock('@/store/user', () => {
  const useUserStore = Object.assign(<T,>(selector: StoreSelector<T>) => selector({}), {
    getState: () => ({}),
  });

  return { useUserStore };
});
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableInputMarkdown: () => false },
  settingsSelectors: { getHotkeyById: () => () => 'alt+enter' },
  systemAgentSelectors: {
    defaultInputCompletion: () => mocks.defaultInputCompletionConfig,
    inputCompletion: () => mocks.inputCompletionConfig,
  },
  userProfileSelectors: { userId: () => 'user-id' },
}));

vi.mock('../hooks/useAgentId', () => ({ useAgentId: () => 'agent-id' }));
vi.mock('../hooks/useLargeFileLocalPath', () => ({
  useLargeFileLocalPath: () => (files: File[]) => files,
}));
vi.mock('../store', () => {
  const editor = {
    dispatchCommand: vi.fn(),
  };
  const state = {
    disableMention: true,
    disableSlash: true,
    editor,
    expand: false,
    handleSendButton: vi.fn(),
    slashMenuRef: { current: null },
    slashPlacement: 'top',
    updateMarkdownContent: vi.fn(),
  };

  return {
    useChatInputStore: <T,>(selector: StoreSelector<T>) => selector(state),
    useStoreApi: () => ({
      getState: () => mocks.chatInputState,
      subscribe: vi.fn(() => vi.fn()),
    }),
  };
});
vi.mock('./ActionTag', () => ({
  INSERT_ACTION_TAG_COMMAND: 'insert-action-tag',
  useSlashActionItems: () => [],
}));
vi.mock('./MentionMenu', () => ({ createMentionMenu: vi.fn(() => vi.fn(() => null)) }));
vi.mock('./Placeholder', () => ({
  default: () => <span>placeholder</span>,
}));
vi.mock('./plugins', () => ({
  CHAT_INPUT_EMBED_PLUGINS: [],
  createChatInputRichPlugins: () => [],
}));
vi.mock('./ReferTopic', () => ({ INSERT_REFER_TOPIC_COMMAND: 'insert-refer-topic' }));
vi.mock('./LocalFileTag', () => ({
  INSERT_LOCAL_FILE_TAG_COMMAND: 'insert-local-file-tag',
}));
vi.mock('./useLocalFileTag', () => ({
  useLocalFileTag: () => ({
    enableLocalFileTag: false,
    searchLocalFiles: vi.fn(async () => []),
  }),
}));
vi.mock('./useMentionCategories', () => ({ useMentionCategories: () => [] }));

describe('ChatInput InputEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateJSON.mockReset();
    permission.allowed = false;
    platform.isMobile = false;
    mocks.inputCompletionConfig.enabled = false;
    mocks.inputCompletionConfig.model = 'gpt-4o-mini';
    mocks.inputCompletionConfig.provider = 'openai';
    mocks.activeWorkspaceId = null;
    mocks.chatInputState.inputCompletionError = undefined;
    mocks.chatInputState.inputCompletionErrorDismissed = false;
    mocks.chainInputCompletion.mockReturnValue({
      messages: [],
      schema: {
        name: 'InputCompletion',
        schema: { type: 'object' },
      },
    });
  });

  it('renders as read-only when create-content permission is denied', () => {
    render(<InputEditor />);

    expect(screen.getByTestId('mock-editor')).toHaveAttribute('data-editable', 'false');
  });

  it('initializes the editor with content captured by a fallback input', () => {
    render(<InputEditor initialContent="typed before the editor loaded" />);

    expect(screen.getByTestId('mock-editor')).toHaveAttribute(
      'data-content',
      'typed before the editor loaded',
    );
  });

  it('renders the editor at 16px on mobile', async () => {
    permission.allowed = true;
    platform.isMobile = true;

    render(<InputEditor />);

    expect((await getEditorStyle())?.fontSize).toBe(16);
  });

  it('keeps the editor font size unchanged on desktop', async () => {
    permission.allowed = true;

    render(<InputEditor />);

    expect((await getEditorStyle())?.fontSize).toBeUndefined();
  });

  it('tags autocomplete requests with the input completion trigger', async () => {
    permission.allowed = true;
    mocks.inputCompletionConfig.enabled = true;
    mocks.generateJSON.mockResolvedValueOnce({ data: { completion: ' world' } });

    render(<InputEditor />);

    const autoCompleteProps = await getAutoCompleteProps();

    await autoCompleteProps.onAutoComplete({
      abortSignal: new AbortController().signal,
      afterText: '',
      input: 'hello',
      suggestionId: 'suggestion-1',
    });

    expect(mocks.generateJSON).toHaveBeenCalledTimes(1);
    expect(mocks.generateJSON.mock.calls[0][0].metadata).toEqual({
      trigger: RequestTrigger.InputCompletion,
    });
  });

  it('pauses autocomplete after a non-abort generation error', async () => {
    permission.allowed = true;
    mocks.inputCompletionConfig.enabled = true;
    mocks.generateJSON.mockRejectedValueOnce(new Error('InsufficientBudgetForModel'));

    render(<InputEditor />);

    const autoCompleteProps = await getAutoCompleteProps();

    const abortController = new AbortController();
    await expect(
      autoCompleteProps.onAutoComplete({
        abortSignal: abortController.signal,
        afterText: '',
        input: 'hello',
        suggestionId: 'suggestion-1',
      }),
    ).resolves.toBeNull();

    expect(mocks.generateJSON).toHaveBeenCalledTimes(1);
    expect(mocks.chatInputState.inputCompletionError?.message).toBe('InsufficientBudgetForModel');

    await expect(
      autoCompleteProps.onAutoComplete({
        abortSignal: abortController.signal,
        afterText: '',
        input: 'hello again',
        suggestionId: 'suggestion-2',
      }),
    ).resolves.toBeNull();

    expect(mocks.generateJSON).toHaveBeenCalledTimes(1);
  });

  it('keeps autocomplete paused when an older in-flight request resolves after a failure', async () => {
    permission.allowed = true;
    mocks.inputCompletionConfig.enabled = true;

    let resolveOlderRequest!: (value: { data: { completion: string } }) => void;
    mocks.generateJSON
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlderRequest = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('InsufficientBudgetForModel'));

    render(<InputEditor />);

    const autoCompleteProps = await getAutoCompleteProps();
    const olderAbortController = new AbortController();
    const newerAbortController = new AbortController();

    const olderCompletion = autoCompleteProps.onAutoComplete({
      abortSignal: olderAbortController.signal,
      afterText: '',
      input: 'older request',
      suggestionId: 'suggestion-1',
    });

    await expect(
      autoCompleteProps.onAutoComplete({
        abortSignal: newerAbortController.signal,
        afterText: '',
        input: 'newer request',
        suggestionId: 'suggestion-2',
      }),
    ).resolves.toBeNull();

    expect(mocks.chatInputState.inputCompletionError?.message).toBe('InsufficientBudgetForModel');

    resolveOlderRequest({ data: { completion: 'older completion' } });

    await expect(olderCompletion).resolves.toBeNull();
    expect(mocks.chatInputState.inputCompletionError?.message).toBe('InsufficientBudgetForModel');
  });

  it('falls back to the default model when the personal provider has no key in a workspace', async () => {
    permission.allowed = true;
    mocks.activeWorkspaceId = 'ws-1';
    mocks.inputCompletionConfig.enabled = true;
    mocks.inputCompletionConfig.model = 'deepseek-v4-flash';
    mocks.inputCompletionConfig.provider = 'deepseek';
    mocks.generateJSON
      .mockRejectedValueOnce(new Error('InvalidProviderAPIKey'))
      .mockResolvedValueOnce({ data: { completion: ' world' } })
      .mockResolvedValueOnce({ data: { completion: ' again' } });

    render(<InputEditor />);

    const autoCompleteProps = await getAutoCompleteProps();

    await expect(
      autoCompleteProps.onAutoComplete({
        abortSignal: new AbortController().signal,
        afterText: '',
        input: 'hello',
        suggestionId: 'suggestion-1',
      }),
    ).resolves.toBe(' world');

    expect(mocks.chatInputState.inputCompletionError).toBeUndefined();
    expect(mocks.generateJSON).toHaveBeenCalledTimes(2);
    expect(mocks.generateJSON.mock.calls[0][0]).toMatchObject({
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    });
    expect(mocks.generateJSON.mock.calls[1][0]).toMatchObject({
      model: 'glm-5.3-flash',
      provider: 'lobehub',
    });

    await expect(
      autoCompleteProps.onAutoComplete({
        abortSignal: new AbortController().signal,
        afterText: '',
        input: 'hello again',
        suggestionId: 'suggestion-2',
      }),
    ).resolves.toBe(' again');

    expect(mocks.generateJSON).toHaveBeenCalledTimes(3);
    expect(mocks.generateJSON.mock.calls[2][0]).toMatchObject({
      model: 'glm-5.3-flash',
      provider: 'lobehub',
    });
  });

  it('pauses instead of falling back when the personal key is invalid outside a workspace', async () => {
    permission.allowed = true;
    mocks.inputCompletionConfig.enabled = true;
    mocks.inputCompletionConfig.model = 'deepseek-v4-flash';
    mocks.inputCompletionConfig.provider = 'deepseek';
    mocks.generateJSON.mockRejectedValueOnce(new Error('InvalidProviderAPIKey'));

    render(<InputEditor />);

    const autoCompleteProps = await getAutoCompleteProps();

    await expect(
      autoCompleteProps.onAutoComplete({
        abortSignal: new AbortController().signal,
        afterText: '',
        input: 'hello',
        suggestionId: 'suggestion-1',
      }),
    ).resolves.toBeNull();

    expect(mocks.generateJSON).toHaveBeenCalledTimes(1);
    expect(mocks.chatInputState.inputCompletionError?.errorType).toBe('InvalidProviderAPIKey');
  });

  it('pauses on non-credential errors in a workspace without retrying', async () => {
    permission.allowed = true;
    mocks.activeWorkspaceId = 'ws-1';
    mocks.inputCompletionConfig.enabled = true;
    mocks.inputCompletionConfig.model = 'deepseek-v4-flash';
    mocks.inputCompletionConfig.provider = 'deepseek';
    mocks.generateJSON.mockRejectedValueOnce(new Error('InsufficientBudgetForModel'));

    render(<InputEditor />);

    const autoCompleteProps = await getAutoCompleteProps();

    await expect(
      autoCompleteProps.onAutoComplete({
        abortSignal: new AbortController().signal,
        afterText: '',
        input: 'hello',
        suggestionId: 'suggestion-1',
      }),
    ).resolves.toBeNull();

    expect(mocks.generateJSON).toHaveBeenCalledTimes(1);
    expect(mocks.chatInputState.inputCompletionError?.message).toBe('InsufficientBudgetForModel');
  });
});
