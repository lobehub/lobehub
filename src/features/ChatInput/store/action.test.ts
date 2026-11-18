import type { IEditor } from '@lobehub/editor';
import { CommonPlugin, Kernel, MarkdownPlugin } from '@lobehub/editor';
import { toast } from '@lobehub/ui';
import { $createParagraphNode, $createTextNode, $getRoot, KEY_ESCAPE_COMMAND } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installMarketMentions, MarketMentionInstallError } from '@/services/mentionMarketInstall';
import { useAgentStore } from '@/store/agent';
import { useFileStore } from '@/store/file';
import { systemAgentSelectors } from '@/store/user/selectors';
import type { UploadFileItem } from '@/types/files/upload';

import { getDraft, saveDraft } from '../draftStorage';
import { SYNC_IMAGE_REF_TAGS_COMMAND } from '../InputEditor/ImageRefTag/ImageRefTagPlugin';
import { getInputHistory } from '../inputHistoryStorage';
import { createStore, selectors } from '.';

vi.mock('@/services/mentionMarketInstall', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installMarketMentions: vi.fn(),
}));

const createHelloEditor = () => ({
  cleanDocument: vi.fn(),
  dispatchCommand: vi.fn(),
  focus: vi.fn(),
  getLexicalEditor: () => ({}),
  getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
});

describe('ChatInput store actions', () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentStore.setState({ activeAgentId: undefined });
    vi.restoreAllMocks();
  });

  it('keeps action lists usable when a host omits them', () => {
    const store = createStore({ leftActions: undefined, rightActions: undefined });

    expect(store.getState().leftActions).toEqual([]);
    expect(store.getState().rightActions).toEqual([]);
  });

  it('clears the autocomplete breaker when dismissing its error', () => {
    const store = createStore();

    store.getState().pauseInputCompletion({ message: 'InsufficientBudgetForModel' });

    expect(selectors.inputCompletionPaused(store.getState())).toBe(true);

    store.getState().dismissInputCompletionError();

    expect(store.getState().inputCompletionError).toBeUndefined();
    expect(selectors.inputCompletionPaused(store.getState())).toBe(false);
    expect(selectors.inputCompletionErrorVisible(store.getState())).toBeUndefined();
  });

  it('records non-empty sent input in local history before the editor is cleared', () => {
    const editorData = { root: { children: [{ text: 'Hello' }] } };
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand: vi.fn(),
      focus: vi.fn(),
      getLexicalEditor: () => ({}),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : editorData)),
    };
    const store = createStore({
      agentId: 'agent-1',
      editor: editor as unknown as IEditor,
      onSend: ({ clearContent }) => {
        clearContent();
      },
    });

    store.getState().handleSendButton();

    expect(getInputHistory({ agentId: 'agent-1' })[0]).toMatchObject({
      json: editorData,
      markdown: 'Hello',
    });
  });

  it('drops the stored draft once the send handler clears the composer', () => {
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand: vi.fn(),
      focus: vi.fn(),
      getLexicalEditor: () => ({}),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { text: 'Hello' })),
    };
    saveDraft('main_agt_a_tpc_1', { text: 'Hello' });
    const store = createStore({
      draftKey: 'main_agt_a_tpc_1',
      editor: editor as unknown as IEditor,
      onSend: ({ clearContent }) => {
        clearContent();
      },
    });

    store.getState().handleSendButton();

    expect(getDraft('main_agt_a_tpc_1')).toBeUndefined();
  });

  it('keeps the stored draft when the send handler declines to clear the composer', () => {
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand: vi.fn(),
      focus: vi.fn(),
      getLexicalEditor: () => ({}),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { text: 'Hello' })),
    };
    saveDraft('main_agt_a_tpc_1', { text: 'Hello' });
    const store = createStore({
      draftKey: 'main_agt_a_tpc_1',
      editor: editor as unknown as IEditor,
      // a scheduled send that the server rejects leaves the text in the
      // composer, so the draft behind it must survive
      onSend: () => {},
    });

    store.getState().handleSendButton();

    expect(getDraft('main_agt_a_tpc_1')).toEqual({ text: 'Hello' });
  });

  it('records sent input in the active agent history when no agent id is provided', () => {
    useAgentStore.setState({ activeAgentId: 'active-agent' });

    const editorData = { root: { children: [{ text: 'Hello' }] } };
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand: vi.fn(),
      focus: vi.fn(),
      getLexicalEditor: () => ({}),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : editorData)),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend: vi.fn(),
    });

    store.getState().handleSendButton();

    expect(getInputHistory({ agentId: 'active-agent' })[0]).toMatchObject({
      json: editorData,
      markdown: 'Hello',
    });
    expect(getInputHistory()).toEqual([]);
  });

  it('sends exactly what the document serializes to', () => {
    // The composer no longer rewrites the text on the way out: markers like the
    // goal chip are nodes in the document, so what is sent is what is shown.
    const onSend = vi.fn(({ clearContent, getMarkdownContent }) => {
      expect(getMarkdownContent()).toBe('/goal Ship the homepage');
      clearContent();
    });
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand: vi.fn(),
      focus: vi.fn(),
      getLexicalEditor: () => ({}),
      getDocument: vi.fn((type: string) =>
        type === 'markdown' ? '/goal Ship the homepage' : { root: {} },
      ),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend,
    });

    store.getState().handleSendButton();

    expect(onSend).toHaveBeenCalledOnce();
    expect(editor.cleanDocument).toHaveBeenCalledOnce();
  });

  it('does not record history when the input history feature is disabled', () => {
    const editor = createHelloEditor();
    const store = createStore({
      editor: editor as unknown as IEditor,
      feature: { inputCompletion: true, inputHistory: false, mention: true, slash: true },
      onSend: vi.fn(),
    });

    store.getState().handleSendButton();

    expect(getInputHistory()).toEqual([]);
  });

  it('clears the input-completion ghost before sending when autocomplete is enabled', () => {
    vi.spyOn(systemAgentSelectors, 'inputCompletion').mockReturnValue({ enabled: true } as any);

    const dispatchCommand = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand,
      focus: vi.fn(),
      getLexicalEditor: () => ({}),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend: vi.fn(),
    });

    store.getState().handleSendButton();

    expect(dispatchCommand).toHaveBeenCalledWith(KEY_ESCAPE_COMMAND, expect.any(Object));
  });

  it('does not dispatch escape on send when autocomplete is disabled', () => {
    const dispatchCommand = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand,
      focus: vi.fn(),
      getLexicalEditor: () => ({}),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend: vi.fn(),
    });

    store.getState().handleSendButton();

    expect(dispatchCommand).not.toHaveBeenCalledWith(KEY_ESCAPE_COMMAND, expect.anything());
  });

  // Regression: sendButtonProps.disabled mirrors editor content through the
  // editor's debounced onChange, so a fast type→Enter arrives while the
  // mirror still reads "empty" and used to be silently dropped.
  it('sends via resolveSendBlocked even when the stale disabled mirror says blocked', () => {
    const onSend = vi.fn();
    const editor = createHelloEditor();
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend,
      resolveSendBlocked: () => false,
      sendButtonProps: { disabled: true, generating: false, onStop: vi.fn() },
    });

    store.getState().handleSendButton();

    expect(onSend).toHaveBeenCalledOnce();
  });

  it('blocks the send when resolveSendBlocked reports blocked', () => {
    const onSend = vi.fn();
    const editor = createHelloEditor();
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend,
      resolveSendBlocked: () => true,
      sendButtonProps: { disabled: false, generating: false, onStop: vi.fn() },
    });

    store.getState().handleSendButton();

    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps gating on sendButtonProps.disabled when no resolver is provided', () => {
    const onSend = vi.fn();
    const editor = createHelloEditor();
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend,
      sendButtonProps: { disabled: true, generating: false, onStop: vi.fn() },
    });

    store.getState().handleSendButton();

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not record history when no send handler is configured', () => {
    const editor = createHelloEditor();
    const store = createStore({
      editor: editor as unknown as IEditor,
    });

    store.getState().handleSendButton();

    expect(getInputHistory()).toEqual([]);
  });

  it('sends a prompt pasted as plain text verbatim instead of reformatting it as markdown', () => {
    const prompt = [
      '# Role',
      'You are a **terse** reviewer.',
      '* Compute 2 * 3 and cite [the answer]',
      '    keep this indented line',
      '1. Read the diff.',
    ].join('\n');
    const editor = new Kernel();
    editor.registerPlugins([CommonPlugin, MarkdownPlugin]);
    editor.initNodeEditor();
    editor.getLexicalEditor()!.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(prompt));
        $getRoot().clear().append(paragraph);
      },
      { discrete: true },
    );
    let sent: string | undefined;
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend: ({ getMarkdownContent }) => {
        sent = getMarkdownContent();
      },
    });

    store.getState().handleSendButton();

    expect(sent).toBe(prompt);
  });

  describe('market entries picked from the @ menu', () => {
    const marketDoc = {
      root: {
        children: [
          {
            children: [
              {
                label: 'Writer',
                metadata: {
                  id: 'market:writer',
                  label: 'Writer',
                  marketIdentifier: 'writer',
                  marketVisibility: 'public',
                  type: 'agent',
                },
                type: 'mention',
              },
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };
    const marketEditor = () => ({
      cleanDocument: vi.fn(),
      dispatchCommand: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) =>
        type === 'markdown' ? '<mention name="Writer" id="market:writer" /> hi' : marketDoc,
      ),
      getLexicalEditor: () => ({}),
    });

    beforeEach(() => {
      vi.mocked(installMarketMentions).mockReset();
    });

    it('installs them first and sends the installed agent id', async () => {
      vi.mocked(installMarketMentions).mockResolvedValue(new Map([['writer', 'agt_writer']]));
      const loadingToast = vi.spyOn(toast, 'loading');
      const onSend = vi.fn();
      const store = createStore({ editor: marketEditor() as unknown as IEditor, onSend });

      store.getState().handleSendButton();

      expect(installMarketMentions).toHaveBeenCalledWith({
        agents: [{ identifier: 'writer', label: 'Writer', visibility: 'public' }],
        skills: [],
      });
      expect(onSend).not.toHaveBeenCalled();
      // The send button's spinner is the only progress cue; no toast.
      expect(store.getState().installingMarketMentions).toBe(true);
      expect(loadingToast).not.toHaveBeenCalled();

      await vi.waitFor(() => expect(onSend).toHaveBeenCalledOnce());
      const { getEditorData, getMarkdownContent } = onSend.mock.calls[0][0];
      expect(getMarkdownContent()).toBe('<mention name="Writer" id="agt_writer" /> hi');
      expect(getEditorData().root.children[0].children[0].metadata).toEqual({
        id: 'agt_writer',
        label: 'Writer',
        type: 'agent',
      });
      expect(store.getState().installingMarketMentions).toBe(false);
    });

    it('sends what the composer holds once ready, even if it was edited during the install', async () => {
      // The composer stays editable while the picked agent installs; replacing
      // it must not send the new agent's unresolved Market placeholder.
      const poetDoc = structuredClone(marketDoc);
      Object.assign(poetDoc.root.children[0].children[0], {
        label: 'Poet',
        metadata: {
          id: 'market:poet',
          label: 'Poet',
          marketIdentifier: 'poet',
          marketVisibility: 'public',
          type: 'agent',
        },
      });
      let current: typeof marketDoc = marketDoc;
      const editor = {
        ...marketEditor(),
        getDocument: vi.fn((type: string) =>
          type === 'markdown'
            ? `<mention name="${current.root.children[0].children[0].label}" id="${current.root.children[0].children[0].metadata.id}" /> hi`
            : current,
        ),
      };
      vi.mocked(installMarketMentions)
        .mockImplementationOnce(async () => {
          current = poetDoc;
          return new Map([['writer', 'agt_writer']]);
        })
        .mockResolvedValueOnce(new Map([['poet', 'agt_poet']]));
      const onSend = vi.fn();
      const store = createStore({ editor: editor as unknown as IEditor, onSend });

      store.getState().handleSendButton();

      await vi.waitFor(() => expect(onSend).toHaveBeenCalledOnce());
      expect(installMarketMentions).toHaveBeenLastCalledWith({
        agents: [{ identifier: 'poet', label: 'Poet', visibility: 'public' }],
        skills: [],
      });
      expect(onSend.mock.calls[0][0].getMarkdownContent()).toBe(
        '<mention name="Poet" id="agt_poet" /> hi',
      );
      expect(store.getState().installingMarketMentions).toBe(false);
    });

    it('drops the send when the composer moved to another conversation during the install', async () => {
      // The composer store outlives a topic switch: the other conversation's
      // draft must not be sent without the user pressing Send there.
      let current: unknown = marketDoc;
      const editor = { ...marketEditor(), getDocument: vi.fn(() => current) };
      const onSend = vi.fn();
      const store = createStore({
        draftKey: 'topic-a',
        editor: editor as unknown as IEditor,
        onSend,
      });
      vi.mocked(installMarketMentions).mockImplementation(async () => {
        current = { root: { children: [{ children: [], type: 'paragraph' }], type: 'root' } };
        store.setState({ draftKey: 'topic-b' });
        return new Map([['writer', 'agt_writer']]);
      });

      store.getState().handleSendButton();
      await vi.waitFor(() => expect(store.getState().installingMarketMentions).toBe(false));

      expect(installMarketMentions).toHaveBeenCalledOnce();
      expect(onSend).not.toHaveBeenCalled();
      expect(editor.cleanDocument).not.toHaveBeenCalled();
    });

    it('keeps the message in the composer when the install fails', async () => {
      vi.mocked(installMarketMentions).mockRejectedValue(new MarketMentionInstallError(['Writer']));
      const onSend = vi.fn();
      const editor = marketEditor();
      const store = createStore({ editor: editor as unknown as IEditor, onSend });

      store.getState().handleSendButton();
      await vi.waitFor(() => expect(store.getState().installingMarketMentions).toBe(false));

      expect(onSend).not.toHaveBeenCalled();
      expect(editor.cleanDocument).not.toHaveBeenCalled();
      expect(getInputHistory()).toEqual([]);
    });
  });
});

describe('sending while uploads are in flight', () => {
  const KEY = 'main_agt_a_tpc_1';
  const upload = (id: string, status: UploadFileItem['status']) =>
    ({
      file: { name: `${id}.png`, type: 'image/png' },
      id,
      previewUrl: `blob:${id}`,
      status,
    }) as unknown as UploadFileItem;
  const setUploads = (files: UploadFileItem[]) =>
    useFileStore.setState({ chatUploadFileListByContext: { [KEY]: files } });

  beforeEach(() => {
    localStorage.clear();
    setUploads([]);
  });

  it('queues the send until every upload settles, then sends with the settled numbering', () => {
    const editor = createHelloEditor();
    const onSend = vi.fn();
    const store = createStore({
      contextSelectionKey: KEY,
      draftKey: KEY,
      editor: editor as unknown as IEditor,
      onSend,
      queueSendWhileUploading: true,
    });
    setUploads([upload('a', 'uploading'), upload('b', 'uploading')]);

    store.getState().handleSendButton();
    expect(onSend).not.toHaveBeenCalled();
    expect(selectors.isSendQueuedForUploads(store.getState())).toBe(true);

    // A second press while queued neither sends nor queues twice.
    store.getState().handleSendButton();
    setUploads([upload('a', 'error'), upload('b', 'uploading')]);
    expect(onSend).not.toHaveBeenCalled();

    setUploads([upload('a', 'error'), upload('b', 'success')]);
    expect(onSend).toHaveBeenCalledOnce();
    expect(selectors.isSendQueuedForUploads(store.getState())).toBe(false);
    // The failed image takes no number, so the one that uploaded is [Image #1].
    const syncPayload = editor.dispatchCommand.mock.calls.find(
      ([command]) => command === SYNC_IMAGE_REF_TAGS_COMMAND,
    )?.[1];
    expect([...syncPayload.refs.values()]).toEqual([{ fileId: 'b', number: 1, src: 'blob:b' }]);
  });

  it('drops a queued send once the composer shows another conversation', () => {
    const onSend = vi.fn();
    const store = createStore({
      contextSelectionKey: KEY,
      draftKey: KEY,
      editor: createHelloEditor() as unknown as IEditor,
      onSend,
      queueSendWhileUploading: true,
    });
    setUploads([upload('a', 'uploading')]);

    store.getState().handleSendButton();
    store.setState({ draftKey: 'main_agt_a_tpc_2' });
    // The conversation now on screen has nothing queued.
    expect(selectors.isSendQueuedForUploads(store.getState())).toBe(false);

    setUploads([upload('a', 'success')]);
    expect(onSend).not.toHaveBeenCalled();
    expect(store.getState().uploadQueuedSend).toBeUndefined();
  });

  it('stops watching the uploads once the queued send is cancelled', () => {
    const onSend = vi.fn();
    const store = createStore({
      contextSelectionKey: KEY,
      draftKey: KEY,
      editor: createHelloEditor() as unknown as IEditor,
      onSend,
      queueSendWhileUploading: true,
    });
    setUploads([upload('a', 'uploading')]);

    store.getState().handleSendButton();
    store.getState().cancelUploadQueuedSend();
    expect(store.getState().uploadQueuedSend).toBeUndefined();

    setUploads([upload('a', 'success')]);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('leaves the upload gate to hosts that do not opt in', () => {
    const onSend = vi.fn();
    const store = createStore({
      contextSelectionKey: KEY,
      editor: createHelloEditor() as unknown as IEditor,
      onSend,
    });
    setUploads([upload('a', 'uploading')]);

    store.getState().handleSendButton();

    expect(onSend).toHaveBeenCalledOnce();
    expect(store.getState().uploadQueuedSend).toBeUndefined();
  });
});
