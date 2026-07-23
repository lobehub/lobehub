'use client';

import { Flexbox, Icon, Skeleton, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { SmilePlus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { truncateByWeightedLength } from '@/utils/textLength';

import { usePageEditorStore } from './store';
import { usePageEditable } from './usePageEditable';

const TitleSection = memo(() => {
  const { t } = useTranslation('file');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const documentId = usePageEditorStore((s) => s.documentId);
  // Gate the title/emoji on the same state as the body editor: edit permission
  // AND not locked by another member (nor pending / save-blocked). The lock makes
  // the whole page read-only, so metadata must not stay editable behind it.
  // `metaReadOnly` additionally locks just the meta (title + emoji) while leaving
  // the body editable — used for managed docs like a skill's `SKILL.md` index,
  // whose identity is renamed through skill APIs, never a plain title save.
  const isMetaReadOnly = usePageEditorStore((s) => s.metaReadOnly);
  const canEdit = usePageEditable() && !isMetaReadOnly;
  const emoji = usePageEditorStore((s) => s.emoji);
  const title = usePageEditorStore((s) => s.title);
  const setEmoji = usePageEditorStore((s) => s.setEmoji);
  const setTitle = usePageEditorStore((s) => s.setTitle);
  const handleTitleSubmit = usePageEditorStore((s) => s.handleTitleSubmit);
  const isDocumentLoading = useDocumentStore(editorSelectors.isDocumentLoading(documentId));
  const showTitleSkeleton = isDocumentLoading && !title;

  const [isHoveringTitle, setIsHoveringTitle] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  return (
    <Flexbox
      gap={16}
      paddingBlock={16}
      style={{
        cursor: 'default',
      }}
      onMouseEnter={() => setIsHoveringTitle(true)}
      onMouseLeave={() => setIsHoveringTitle(false)}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {/* Emoji picker above Choose Icon button */}
      {(emoji || showEmojiPicker) && (
        <EmojiPicker
          allowDelete
          locale={locale}
          open={showEmojiPicker}
          shape={'square'}
          size={72}
          title={t('pageEditor.chooseIcon')}
          value={emoji}
          onChange={(e) => {
            if (!canEdit) return;

            setEmoji(e);
            setShowEmojiPicker(false);
          }}
          onDelete={() => {
            if (!canEdit) return;

            setEmoji(undefined);
            setShowEmojiPicker(false);
          }}
          onOpenChange={(open) => {
            if (!canEdit) return;

            setShowEmojiPicker(open);
          }}
        />
      )}

      {/* Choose Icon button - only shown when no emoji */}
      {!emoji && !showEmojiPicker && (
        <Button
          disabled={!canEdit}
          icon={<Icon icon={SmilePlus} />}
          size="small"
          type="text"
          style={{
            opacity: isHoveringTitle ? 1 : 0,
            transition: `opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut}`,
            width: 'fit-content',
          }}
          onClick={() => {
            if (!canEdit) return;

            setEmoji('📄');
            setShowEmojiPicker(true);
          }}
        >
          {t('pageEditor.chooseIcon')}
        </Button>
      )}

      {/* Title Input */}
      {showTitleSkeleton ? (
        <Skeleton.Button active style={{ height: 44, width: 320 }} />
      ) : (
        <TextArea
          autoSize={{ minRows: 1 }}
          disabled={!canEdit}
          placeholder={t('pageEditor.titlePlaceholder')}
          value={title}
          variant={'borderless'}
          style={{
            fontSize: 36,
            fontWeight: 600,
            padding: 0,
            resize: 'none',
            width: '100%',
            borderRadius: '0px',
          }}
          onChange={(e) => {
            const truncated = truncateByWeightedLength(e.target.value, 100);
            if (!canEdit) return;

            setTitle(truncated);
          }}
          onKeyDown={(e) => {
            if (!canEdit) return;

            if (e.key === 'Enter') {
              e.preventDefault();
              handleTitleSubmit();
            }
          }}
        />
      )}
    </Flexbox>
  );
});

export default TitleSection;
