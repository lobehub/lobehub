import { Button, Flexbox, Icon, Tag, Text, TextArea, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageSquareIcon, SendIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { serializeArtboardReferences } from '@/features/ChatInput/InputEditor/ReferArtboard';
import { getProjectTopicPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { artboardService } from '@/services/artboard';
import { useChatStore } from '@/store/chat';

import { useArtboard } from '../data/useArtboard';
import { artboardActions, useArtboardStore } from '../store';
import { ARTBOARD_SEARCH_PARAM } from '../useOpenArtboardFromRoute';

const styles = stylex.create({
  bar: {
    backgroundColor: cssVar.colorBgContainer,
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    flex: 'none',
    paddingBlock: 10,
    paddingInline: 16,
  },
});

interface GalleryFooterProps {
  artboardId: string;
  onLeave: () => void;
}

const GalleryFooter = ({ artboardId, onLeave }: GalleryFooterProps) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const [text, setText] = useState('');
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
        onMessageAccepted: () => {
          artboardActions.clearGalleryRefs();
          setText('');
        },
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  const openConversation = () => {
    if (!topic?.projectId || !topicId) return;
    onLeave();
    navigate(
      `${getProjectTopicPath(topic.projectId, topicId)}?${ARTBOARD_SEARCH_PARAM}=${artboardId}`,
    );
  };

  if (!topicId) return null;

  return (
    <Flexbox gap={8} {...stylex.props(styles.bar)}>
      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('artboard.gallery.sendTo', { title: topic?.title || t('artboard.gallery.untitled') })}
        </Text>
        <Button
          disabled={!topic?.projectId}
          icon={<Icon icon={MessageSquareIcon} />}
          size={'small'}
          type={'text'}
          onClick={openConversation}
        >
          {t('artboard.gallery.openConversation')}
        </Button>
      </Flexbox>
      {refs.length > 0 && (
        <Flexbox horizontal gap={6} wrap="wrap">
          {refs.map((ref, index) => (
            <Tag
              closable
              key={`${ref.itemId}:${index}`}
              size={'small'}
              onClose={() => artboardActions.removeGalleryRef(index)}
            >
              {ref.kind === 'decision'
                ? t('artboard.chat.decided', { text: ref.text })
                : `${ref.itemTitle} · ${ref.text}`}
            </Tag>
          ))}
        </Flexbox>
      )}
      <Flexbox horizontal align="flex-end" gap={8}>
        <TextArea
          autoSize={{ maxRows: 4, minRows: 1 }}
          disabled={!conversation}
          placeholder={t('artboard.gallery.placeholder')}
          style={{ flex: 1 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          disabled={!conversation || (!text.trim() && !refs.length)}
          icon={<Icon icon={SendIcon} />}
          loading={sending}
          type={'primary'}
          onClick={send}
        />
      </Flexbox>
    </Flexbox>
  );
};

export default GalleryFooter;
