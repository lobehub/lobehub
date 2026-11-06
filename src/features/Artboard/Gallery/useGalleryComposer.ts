import { isRecord } from '@lobechat/utils/object';
import { toast } from '@lobehub/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getDraft, saveDraft } from '@/features/ChatInput/draftStorage';
import { serializeArtboardReferences } from '@/features/ChatInput/InputEditor/ReferArtboard';
import { getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { artboardService } from '@/services/artboard';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useArtboard } from '../data/useArtboard';
import { artboardActions, useArtboardStore } from '../store';
import { ARTBOARD_SEARCH_PARAM } from '../useOpenArtboardFromRoute';

export const useGalleryComposer = (artboardId: string, onLeave: () => void) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const text = useArtboardStore((s) => s.galleryText);
  const setText = artboardActions.setGalleryText;
  const [sending, setSending] = useState(false);
  const refs = useArtboardStore((s) => s.galleryRefs);
  const { data } = useArtboard(artboardId);
  const artboard = data?.artboard;
  const topicId = artboard?.originTopicId ?? null;
  const { data: topic } = useClientDataSWR(topicId ? ['artboard-topic', topicId] : null, () =>
    artboardService.getConversation(topicId!),
  );
  const agentId = topic?.agentId ?? null;
  const conversation = agentId && topicId ? { agentId, topicId } : null;

  useEffect(() => {
    artboardActions.setGallery(agentId && topicId ? { agentId, topicId } : null);
    return () => artboardActions.setGallery(null);
  }, [agentId, topicId]);

  const translate = (key: string, options?: Record<string, unknown>) =>
    t(key as 'artboard.chat.quote', options) as string;

  const send = async () => {
    if (!conversation || (!text.trim() && !refs.length)) return;
    setSending(true);
    try {
      await useChatStore.getState().sendMessage({
        context: conversation,
        inputEditor: null,
        message: [serializeArtboardReferences(refs, translate), text.trim()]
          .filter(Boolean)
          .join('\n\n'),
        onMessageAccepted: () =>
          artboardActions.acceptGalleryDraft(conversation.topicId, { refs, text }),
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  const openConversation = () => {
    if (!topic?.projectId || !conversation) return;
    if (text || refs.length) {
      const key = messageMapKey(conversation);
      const chat = useChatStore.getState();
      const editor =
        chat.activeAgentId === agentId && chat.activeTopicId === topicId
          ? chat.mainInputEditor
          : null;
      const existing =
        (editor?.instance?.getLexicalEditor() ? editor.getJSONState() : undefined) ?? getDraft(key);
      const root = isRecord(existing?.root) ? existing.root : { type: 'root', version: 1 };
      const paragraph = (children: unknown[]) => ({
        children,
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        type: 'paragraph',
        version: 1,
      });
      const json = {
        root: {
          direction: null,
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
          ...root,
          children: [
            ...refs.map((ref) => paragraph([{ ...ref, type: 'refer-artboard', version: 1 }])),
            ...(Array.isArray(root.children) ? root.children : []),
            ...text.split('\n').map((line) =>
              paragraph([
                {
                  detail: 0,
                  format: 0,
                  mode: 'normal',
                  style: '',
                  text: line,
                  type: 'text',
                  version: 1,
                },
              ]),
            ),
          ],
        },
      };
      if (saveDraft(key, json) === undefined) return;
      if (editor?.instance?.getLexicalEditor()) editor.setJSONState(json);
      artboardActions.clearGalleryRefs();
    }
    onLeave();
    navigate(
      `${getProjectTopicPath(topic.projectId, conversation.topicId)}?${ARTBOARD_SEARCH_PARAM}=${artboardId}`,
    );
  };

  return { conversation, openConversation, refs, send, sending, setText, text, topic, topicId };
};
