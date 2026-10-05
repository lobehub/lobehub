import { AGENT_CHAT_URL } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  draftToMainComposer,
  queueDraftForMainComposer,
  useComposerDraftBus,
} from '@/features/Conversation/composerDraftBus';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';

import { useImageStage } from '../context';
import { buildDerivedFileName } from '../geometry';
import { loadStageImage } from './AIEdit/deps';
import { ImagePixelsUnavailableError, renderImageToBlob } from './exportImage';
import { buildMarkupMessage, type ImageMarkup, isMarkupEmpty } from './markup';

/**
 * Hand the marked-up image to chat: the image with its drawings and numbered
 * comment markers becomes an attachment, and the comments become text in the
 * chat input. Nothing is sent; the user reviews the input and sends it.
 *
 * Next to a conversation (the chat file preview) both land in its input. From
 * a surface without one (the resource library), they wait for the inbox
 * agent's input and the viewer navigates there.
 */
export const useSendMarkupToChat = () => {
  const { t } = useTranslation('file');
  const { name, url } = useImageStage();
  const navigate = useWorkspaceAwareNavigate();
  const hasComposer = useComposerDraftBus((s) => s.attached);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (markup: ImageMarkup): Promise<boolean> => {
      if (isMarkupEmpty(markup)) return false;
      const attached = useComposerDraftBus.getState().attached;
      const agentId = attached ? useChatStore.getState().activeAgentId : inboxAgentId;
      if (!agentId) {
        toast.error(t('imageViewer.markup.noConversation'));
        return false;
      }

      setSending(true);
      try {
        const img = await loadStageImage(url);
        const blob = await renderImageToBlob(img, {
          comments: markup.comments,
          shapes: markup.shapes,
        });
        const file = new File([blob], buildDerivedFileName(name, 'annotated'), {
          type: blob.type || 'image/png',
        });
        const text = buildMarkupMessage(markup, { name, t });

        // The attachment shows in the input right away; the upload reports its
        // own progress and errors there.
        void useFileStore.getState().uploadChatFiles([file], agentId);

        if (attached) {
          draftToMainComposer(text, { append: true });
          toast.success(t('imageViewer.markup.added'));
        } else {
          queueDraftForMainComposer(text, { agentId });
          navigate(AGENT_CHAT_URL(agentId));
        }
        return true;
      } catch (error) {
        console.error('[ImageViewer] send markup to chat failed', error);
        toast.error(
          error instanceof ImagePixelsUnavailableError
            ? t('imageViewer.pixelsUnavailable')
            : t('imageViewer.markup.failed'),
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [inboxAgentId, name, navigate, t, url],
  );

  return { hasComposer, send, sending };
};
