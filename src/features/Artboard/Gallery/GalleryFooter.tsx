import { Button, Flexbox, Icon, Tag, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageSquareIcon, SendIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { artboardActions } from '../store';
import { useGalleryComposer } from './useGalleryComposer';

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
  const { conversation, openConversation, refs, send, sending, setText, text, topic, topicId } =
    useGalleryComposer(artboardId, onLeave);

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
              {`${ref.itemTitle} · ${ref.text}`}
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
