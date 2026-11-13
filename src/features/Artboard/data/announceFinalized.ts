import type { ArtboardItem } from '@lobechat/types';
import { t } from 'i18next';

import { serializeArtboardReferences } from '@/features/ChatInput/InputEditor/ReferArtboard';
import { useChatStore } from '@/store/chat';

import { artboardActions, useArtboardStore } from '../store';

interface AnnounceParams {
  acceptanceUrl: string;
  artboard: Pick<ArtboardItem, 'title' | 'topicId'>;
  count: number;
}

const translate = (key: string, options?: Record<string, unknown>) =>
  t(key as 'artboard.chat.quote', { ...options, ns: 'project' }) as string;

const resolveTarget = (topicId: string | null) => {
  const { gallery, galleryRefs, galleryText } = useArtboardStore.getState();
  if (gallery)
    return {
      clear: () =>
        artboardActions.acceptGalleryDraft(gallery.topicId, {
          refs: galleryRefs,
          text: galleryText,
        }),
      context: gallery,
      editor: null,
      quoted: [serializeArtboardReferences(galleryRefs, translate), galleryText]
        .filter(Boolean)
        .join('\n\n'),
    };

  const { activeAgentId, activeTopicId, mainInputEditor } = useChatStore.getState();
  if (!activeAgentId || !activeTopicId || activeTopicId !== topicId) return;
  return {
    clear: () => mainInputEditor?.clearContent(),
    context: { agentId: activeAgentId, topicId: activeTopicId },
    editor: mainInputEditor ?? null,
    quoted: mainInputEditor?.getMarkdownContent().trim() ?? '',
  };
};

export const announceFinalized = async ({ acceptanceUrl, artboard, count }: AnnounceParams) => {
  const target = resolveTarget(artboard.topicId);
  if (!target) return;

  const line = translate('artboard.finalize.message', { count, title: artboard.title });
  const link = `[${translate('artboard.finalize.openAcceptance')}](${acceptanceUrl})`;

  await useChatStore.getState().sendMessage({
    context: target.context,
    inputEditor: target.editor,
    message: [target.quoted, `${line} ${link}`].filter(Boolean).join('\n\n'),
    onMessageAccepted: target.clear,
  });
};
