/**
 * @vitest-environment happy-dom
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EditorCanvas from './index';

const editorProps = vi.hoisted(() => ({
  last: undefined as any,
}));

const editorDocuments = {
  json: undefined as unknown,
  markdown: '',
};
const editor = {
  getDocument: vi.fn((format: 'json' | 'markdown') => editorDocuments[format]),
  setDocument: vi.fn((format: 'json' | 'markdown', value: unknown) => {
    if (format === 'markdown') {
      editorDocuments.markdown = String(value ?? '');
    } else {
      editorDocuments.json = value;
    }
  }),
};

const handleContentChange = vi.fn();
const flushSave = vi.fn().mockResolvedValue(undefined);
const setHasEdited = vi.fn();
const permissionState = {
  allowed: false,
};
const agentStoreMock = vi.hoisted(() => {
  const updateAgentConfigById = vi.fn();

  return {
    listeners: new Set<() => void>(),
    state: {
      activeAgentId: 'agent-a',
      agentMap: {
        'agent-a': {
          editorData: undefined,
          systemRole: 'readonly prompt',
        },
      } as Record<string, { editorData?: unknown; systemRole?: string }>,
      streamingSystemRole: undefined as string | undefined,
      streamingSystemRoleAgentId: undefined as string | undefined,
      streamingSystemRoleInProgress: false,
      updateAgentConfigById,
    },
  };
});
const { state: agentStoreState } = agentStoreMock;
const { updateAgentConfigById } = agentStoreState;

type UseSyncExternalStore = <Snapshot>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot?: () => Snapshot,
) => Snapshot;

vi.mock('@lobehub/editor/react', () => ({
  Editor: Object.assign(
    vi.fn((props: any) => {
      editorProps.last = props;
      return <div data-testid="profile-editor" />;
    }),
    { withProps: (_plugin: unknown, props: unknown) => ({ props }) },
  ),
}));

vi.mock('@lobehub/editor', () => ({
  ReactMentionPlugin: vi.fn(),
  ReactTablePlugin: vi.fn(),
  ReactToolbarPlugin: vi.fn(),
}));

vi.mock('@/features/ChatInput/InputEditor/plugins', () => ({
  createChatInputRichPlugins: () => [],
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: permissionState.allowed, reason: 'requires member' }),
}));

vi.mock('@/store/agent', async () => {
  const { useSyncExternalStore } = await vi.importActual<{
    useSyncExternalStore: UseSyncExternalStore;
  }>('react');

  return {
    useAgentStore: (selector: any) =>
      useSyncExternalStore(
        (listener) => {
          agentStoreMock.listeners.add(listener);
          return () => agentStoreMock.listeners.delete(listener);
        },
        () => selector(agentStoreState),
        () => selector(agentStoreState),
      ),
  };
});

vi.mock('../ProfileEditor/MentionList', () => ({
  useMentionOptions: () => undefined,
}));

vi.mock('../store', () => ({
  useProfileStore: (selector: any) =>
    selector({
      editor,
      flushSave,
      handleContentChange,
      hasEdited: false,
      lockState: { holderId: null, lockedByOther: false, pending: false },
      setHasEdited,
    }),
}));

vi.mock('./TypoBar', () => ({
  default: () => <div />,
}));

vi.mock('./useSlashItems', () => ({
  useSlashItems: () => [],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Agent profile EditorCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorProps.last = undefined;
    permissionState.allowed = false;
    agentStoreMock.listeners.clear();
    agentStoreState.activeAgentId = 'agent-a';
    agentStoreState.agentMap = {
      'agent-a': {
        editorData: undefined,
        systemRole: 'readonly prompt',
      },
    };
    agentStoreState.streamingSystemRole = undefined;
    agentStoreState.streamingSystemRoleAgentId = undefined;
    agentStoreState.streamingSystemRoleInProgress = false;
    editorDocuments.json = undefined;
    editorDocuments.markdown = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes editable=false to the editor when workspace permission blocks edits', () => {
    render(<EditorCanvas />);

    expect(editorProps.last?.editable).toBe(false);
  });

  it('uses the rich-editor placeholder key', () => {
    render(<EditorCanvas />);

    expect(editorProps.last?.lineEmptyPlaceholder).toBe('settingAgent.prompt.editorPlaceholder');
    expect(editorProps.last?.placeholder).toBe('settingAgent.prompt.editorPlaceholder');
  });

  it('binds a draft save to its original agent and loads the next agent content', async () => {
    permissionState.allowed = true;
    const agentAEditorData = { root: { children: ['agent-a'] } };
    const agentBEditorData = { root: { children: ['agent-b'] } };
    agentStoreState.agentMap = {
      'agent-a': { editorData: agentAEditorData, systemRole: 'agent-a prompt' },
      'agent-b': { editorData: agentBEditorData, systemRole: 'agent-b prompt' },
    };

    render(<EditorCanvas />);

    act(() => editorProps.last?.onInit());
    await waitFor(() => expect(editor.setDocument).toHaveBeenCalledWith('json', agentAEditorData));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    editorDocuments.json = { root: { children: ['agent-a edited'] } };
    editorDocuments.markdown = 'agent-a edited';
    act(() => editorProps.last?.onTextChange(editor));
    expect(handleContentChange).toHaveBeenCalledWith('agent-a', updateAgentConfigById, editor);

    act(() => {
      agentStoreState.activeAgentId = 'agent-b';
      agentStoreMock.listeners.forEach((listener) => listener());
    });

    await waitFor(() => expect(flushSave).toHaveBeenCalledWith('agent-a'));
    expect(editorProps.last?.content).toEqual(agentBEditorData);

    act(() => editorProps.last?.onInit());
    await waitFor(() => expect(editor.setDocument).toHaveBeenCalledWith('json', agentBEditorData));
  });

  it('replaces hydrated editor data with a later server config before local editing starts', async () => {
    permissionState.allowed = true;
    const hydratedEditorData = { root: { children: ['hydrated'] } };
    const serverEditorData = { root: { children: ['server'] } };
    agentStoreState.agentMap = {
      'agent-a': { editorData: hydratedEditorData, systemRole: 'hydrated prompt' },
    };

    render(<EditorCanvas />);
    act(() => editorProps.last?.onInit());
    await waitFor(() =>
      expect(editor.setDocument).toHaveBeenCalledWith('json', hydratedEditorData),
    );
    editor.setDocument.mockClear();

    act(() => {
      agentStoreState.agentMap = {
        'agent-a': { editorData: serverEditorData, systemRole: 'server prompt' },
      };
      agentStoreMock.listeners.forEach((listener) => listener());
    });

    await waitFor(() => expect(editor.setDocument).toHaveBeenCalledWith('json', serverEditorData));
  });

  it('ignores the editor delayed callback for a programmatic document sync', async () => {
    vi.useFakeTimers();
    permissionState.allowed = true;
    const editorData = { root: { children: ['programmatic'] } };
    agentStoreState.agentMap = {
      'agent-a': { editorData, systemRole: 'programmatic prompt' },
    };

    render(<EditorCanvas />);
    act(() => editorProps.last?.onInit());
    expect(editor.setDocument).toHaveBeenCalledWith('json', editorData);

    const delayedOnTextChange = editorProps.last?.onTextChange;
    setTimeout(() => delayedOnTextChange?.(editor), 100);
    await act(() => vi.advanceTimersByTimeAsync(100));

    expect(handleContentChange).not.toHaveBeenCalled();
    expect(setHasEdited).not.toHaveBeenCalled();
  });

  it('does not overwrite a local draft with a later editor-data refresh', async () => {
    permissionState.allowed = true;
    const initialEditorData = { root: { children: ['initial'] } };
    const serverEditorData = { root: { children: ['server'] } };
    agentStoreState.agentMap = {
      'agent-a': { editorData: initialEditorData, systemRole: 'initial prompt' },
    };

    render(<EditorCanvas />);
    act(() => editorProps.last?.onInit());
    await waitFor(() => expect(editor.setDocument).toHaveBeenCalledWith('json', initialEditorData));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    editorDocuments.json = { root: { children: ['local draft'] } };
    editorDocuments.markdown = 'local draft';
    act(() => editorProps.last?.onTextChange(editor));
    editor.setDocument.mockClear();

    act(() => {
      agentStoreState.agentMap = {
        'agent-a': { editorData: serverEditorData, systemRole: 'server prompt' },
      };
      agentStoreMock.listeners.forEach((listener) => listener());
    });

    expect(editor.setDocument).not.toHaveBeenCalled();
    expect(handleContentChange).toHaveBeenCalledWith('agent-a', updateAgentConfigById, editor);
  });

  it('ignores a stream inherited from the previously active agent', async () => {
    permissionState.allowed = true;
    const agentBEditorData = { root: { children: ['agent-b'] } };
    agentStoreState.activeAgentId = 'agent-b';
    agentStoreState.agentMap = {
      'agent-b': { editorData: agentBEditorData, systemRole: 'agent-b prompt' },
    };
    agentStoreState.streamingSystemRole = 'agent-a stream';
    agentStoreState.streamingSystemRoleAgentId = 'agent-a';
    agentStoreState.streamingSystemRoleInProgress = true;

    render(<EditorCanvas />);
    act(() => editorProps.last?.onInit());

    expect(editor.setDocument).not.toHaveBeenCalledWith('markdown', 'agent-a stream');
    await waitFor(() => expect(editor.setDocument).toHaveBeenCalledWith('json', agentBEditorData));
    expect(handleContentChange).not.toHaveBeenCalled();
  });
});
