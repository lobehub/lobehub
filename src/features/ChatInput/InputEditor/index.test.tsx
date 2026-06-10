import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InputEditor from './index';

const permission = vi.hoisted(() => ({
  allowed: false,
}));

type StoreSelector<T = unknown> = (state: Record<PropertyKey, unknown>) => T;

vi.mock('@lobechat/const', () => ({ isDesktop: false }));
vi.mock('@lobechat/const/hotkeys', () => ({
  HotkeyEnum: { AddUserMessage: 'add-user-message' },
  KeyEnum: { Alt: 'alt', Enter: 'enter' },
}));
vi.mock('@lobechat/heterogeneous-agents', () => ({ HETEROGENEOUS_TYPE_LABELS: {} }));
vi.mock('@lobechat/prompts', () => ({
  chainInputCompletion: vi.fn(),
  escapeXmlAttr: (value: string) => value,
}));
vi.mock('@lobechat/utils', () => ({
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
    FloatMenu: vi.fn(() => null),
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
vi.mock('@/services/aiChat', () => ({ aiChatService: new Proxy({}, { get: () => vi.fn() }) }));
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(<T,>(selector: StoreSelector<T>) => selector({}), {
    getState: () => ({ activeTopicId: undefined }),
  }),
}));
vi.mock('../hooks/useChatInputDraft', () => ({
  useChatInputDraft: () => ({ restoreDraft: vi.fn(), saveDraftDebounced: vi.fn() }),
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
    inputCompletion: () => ({ enabled: false }),
  },
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
      getState: () => ({ getMessages: vi.fn() }),
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
vi.mock('./useLocalFileMention', () => ({
  useLocalFileMention: () => ({
    enableLocalFileMention: false,
    searchLocalFiles: vi.fn(async () => []),
  }),
}));
vi.mock('./useMentionCategories', () => ({ useMentionCategories: () => [] }));

describe('ChatInput InputEditor', () => {
  it('renders as read-only when create-content permission is denied', () => {
    permission.allowed = false;

    render(<InputEditor />);

    expect(screen.getByTestId('mock-editor')).toHaveAttribute('data-editable', 'false');
  });
});
