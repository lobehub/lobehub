import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InputEditor from './index';

const permission = vi.hoisted(() => ({
  allowed: false,
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
    inputCompletionError: undefined as { message: string } | undefined,
    inputCompletionErrorDismissed: false,
    pauseInputCompletion: vi.fn((error: { message: string }) => {
      chatInputState.inputCompletionError = error;
      chatInputState.inputCompletionErrorDismissed = false;
    }),
  };

  return {
    chainInputCompletion: vi.fn(),
    chatInputState,
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
    vi.fn(({ editable }: { editable?: boolean }) => (
      <div data-editable={String(editable)} data-testid="mock-editor" />
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
vi.mock('@lobehub/ui', () => ({ combineKeys: vi.fn(() => 'alt+enter') }));
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
  useChatStore: Object.assign(<T,>(selector: StoreSelector<T>) => selector({}), {
    getState: () => ({ activeTopicId: undefined }),
  }),
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
    inputCompletion: () => mocks.inputCompletionConfig,
  },
  userProfileSelectors: { userId: () => 'user-id' },
}));

vi.mock('../hooks/useAgentId', () => ({ useAgentId: () => 'agent-id' }));
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
    permission.allowed = false;
    mocks.inputCompletionConfig.enabled = false;
    mocks.inputCompletionConfig.model = 'gpt-4o-mini';
    mocks.inputCompletionConfig.provider = 'openai';
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
});
