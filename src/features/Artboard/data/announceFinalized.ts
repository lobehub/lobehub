import type { ArtboardItem } from '@lobechat/types';
import { t } from 'i18next';

import { useChatStore } from '@/store/chat';

import { useArtboardStore } from '../store';
import { resolveBoardConversation } from './boardConversation';

interface AnnounceParams {
  acceptanceUrl: string;
  artboard: Pick<ArtboardItem, 'title' | 'topicId'>;
  count: number;
}

const translate = (key: string, options?: Record<string, unknown>) =>
  t(key as 'artboard.chat.quote', { ...options, ns: 'project' }) as string;

const resolveTarget = async (topicId: string | null) => {
  if (useArtboardStore.getState().gallery) {
    const context = await resolveBoardConversation(topicId);
    return context ? { clear: undefined, context, editor: null, quoted: '' } : undefined;
  }

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
  const target = await resolveTarget(artboard.topicId);
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
