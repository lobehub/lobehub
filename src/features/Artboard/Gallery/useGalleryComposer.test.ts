import { act, renderHook, waitFor } from '@testing-library/react';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type ParagraphNode,
  type SerializedEditorState,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraft, saveDraft } from '@/features/ChatInput/draftStorage';
import { ReferArtboardNode } from '@/features/ChatInput/InputEditor/ReferArtboard/ReferArtboardNode';
import { useChatStore } from '@/store/chat';

import { artboardActions } from '../store';
import { useGalleryComposer } from './useGalleryComposer';

const { navigate, sendMessage } = vi.hoisted(() => ({ navigate: vi.fn(), sendMessage: vi.fn() }));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('../useArtboardFeature', () => ({
  useArtboardFeature: () => ({ enabled: true, ready: true }),
}));
vi.mock('@/services/artboard', () => ({
  artboardService: {
    get: async () => ({ artboard: { topicId: 'topic_1' } }),
    getConversation: async () => ({ agentId: 'agent_1', projectId: 'project_1', title: 'Origin' }),
  },
}));

const refs = ['f1', 'f2'].map((itemId) => ({
  artboardId: 'art_1',
  itemId,
  itemTitle: itemId,
  text: `Comment on ${itemId}`,
}));

const open = async () => {
  const hook = renderHook(() => useGalleryComposer('art_1', vi.fn()));
  await waitFor(() => expect(hook.result.current.conversation?.topicId).toBe('topic_1'));
  return hook;
};

beforeEach(() => {
  localStorage.clear();
  useChatStore.setState({
    activeAgentId: 'another-agent',
    activeTopicId: 'another-topic',
    mainInputEditor: null,
    sendMessage,
  });
  sendMessage.mockReset();
  navigate.mockClear();
});

afterEach(() => artboardActions.reset());

describe('useGalleryComposer', () => {
  it('preserves text and multiple references across close and reopen', async () => {
    const first = await open();
    act(() => {
      first.result.current.setText('Pending discussion');
      refs.forEach(artboardActions.addGalleryRef);
    });
    first.unmount();
    const second = await open();

    expect(second.result.current.text).toBe('Pending discussion');
    expect(second.result.current.refs).toEqual(refs);
  });

  it('hands pending text and references to the origin composer without replacing its draft', async () => {
    const editor = createEditor({ nodes: [ReferArtboardNode] });
    editor.update(
      () => $getRoot().append($createParagraphNode().append($createTextNode('Existing draft'))),
      { discrete: true },
    );
    saveDraft('main_agent_1_topic_1', editor.getEditorState().toJSON());
    const hook = await open();
    act(() => {
      hook.result.current.setText('Pending discussion');
      refs.forEach(artboardActions.addGalleryRef);
    });

    act(() => hook.result.current.openConversation());

    const draft = JSON.stringify(getDraft('main_agent_1_topic_1'));
    expect(draft).toContain('Existing draft');
    expect(draft).toContain('Pending discussion');
    refs.forEach((ref) => expect(draft).toContain(ref.text));
    const restored = editor.parseEditorState(
      getDraft('main_agent_1_topic_1') as unknown as SerializedEditorState,
    );
    restored.read(() => {
      expect(
        $getRoot()
          .getChildren<ParagraphNode>()
          .slice(0, 2)
          .map((node) => node.getFirstChild<ReferArtboardNode>()?.reference),
      ).toEqual(refs);
      expect($getRoot().getTextContent()).toContain('Pending discussion');
    });
    expect(navigate).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('retains the gallery draft on a rejected send and clears it only on acceptance', async () => {
    const hook = await open();
    act(() => {
      hook.result.current.setText('Pending discussion');
      refs.forEach(artboardActions.addGalleryRef);
    });
    sendMessage.mockRejectedValueOnce(new Error('Rejected'));
    await act(async () => hook.result.current.send());
    expect(hook.result.current.text).toBe('Pending discussion');
    expect(hook.result.current.refs).toEqual(refs);

    sendMessage.mockImplementationOnce(async ({ onMessageAccepted }) => onMessageAccepted());
    await act(async () => hook.result.current.send());
    hook.unmount();
    const reopened = await open();
    expect(reopened.result.current.text).toBe('');
    expect(reopened.result.current.refs).toEqual([]);
  });

  it('clears an accepted draft even when the gallery closes while sending', async () => {
    const hook = await open();
    act(() => {
      hook.result.current.setText('Pending discussion');
      refs.forEach(artboardActions.addGalleryRef);
    });
    let accept: () => void = () => {};
    sendMessage.mockImplementationOnce(
      ({ onMessageAccepted }) =>
        new Promise<void>((resolve) => {
          accept = () => {
            onMessageAccepted();
            resolve();
          };
        }),
    );
    let pending: Promise<void>;
    act(() => {
      pending = hook.result.current.send();
    });
    hook.unmount();
    await act(async () => {
      accept();
      await pending;
    });
    const reopened = await open();

    expect(reopened.result.current.text).toBe('');
    expect(reopened.result.current.refs).toEqual([]);
  });
});
