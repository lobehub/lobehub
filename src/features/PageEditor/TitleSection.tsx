'use client';

import { Button, Flexbox, Icon, TextArea } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { SmilePlus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { truncateByWeightedLength } from '@/utils/textLength';

import { usePageEditorStore } from './store';

const TitleSection = memo(() => {
  const { t } = useTranslation('file');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const emoji = usePageEditorStore((s) => s.emoji);
  const title = usePageEditorStore((s) => s.title);
  const setEmoji = usePageEditorStore((s) => s.setEmoji);
  const setTitle = usePageEditorStore((s) => s.setTitle);
  const handleTitleSubmit = usePageEditorStore((s) => s.handleTitleSubmit);

  const [isHoveringTitle, setIsHoveringTitle] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  return (
    <Flexbox
      gap={16}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onMouseEnter={() => setIsHoveringTitle(true)}
      onMouseLeave={() => setIsHoveringTitle(false)}
      paddingBlock={16}
      style={{
        cursor: 'default',
      }}
    >
      {/* Emoji picker above Choose Icon button */}
      {(emoji || showEmojiPicker) && (
        <EmojiPicker
          allowDelete
          locale={locale}
          onChange={(e) => {
            setEmoji(e);
            setShowEmojiPicker(false);
          }}
          onDelete={() => {
            setEmoji(undefined);
            setShowEmojiPicker(false);
          }}
          onOpenChange={(open) => {
            setShowEmojiPicker(open);
          }}
          open={showEmojiPicker}
          shape={'square'}
          size={72}
          title={t('pageEditor.chooseIcon')}
          value={emoji}
        />
      )}

      {/* Choose Icon button - only shown when no emoji */}
      {!emoji && !showEmojiPicker && (
        <Button
          icon={<Icon icon={SmilePlus} />}
          onClick={() => {
            setEmoji('📄');
            setShowEmojiPicker(true);
          }}
          size="small"
          style={{
            opacity: isHoveringTitle ? 1 : 0,
            transition: `opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut}`,
            width: 'fit-content',
          }}
          type="text"
        >
          {t('pageEditor.chooseIcon')}
        </Button>
      )}

      {/* Title Input */}
      <TextArea
        autoSize={{ minRows: 1 }}
        onChange={(e) => {
          const truncated = truncateByWeightedLength(e.target.value, 100);
          setTitle(truncated);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleTitleSubmit();
          }
        }}
        placeholder={t('pageEditor.titlePlaceholder')}
        style={{
          fontSize: 36,
          fontWeight: 600,
          padding: 0,
          resize: 'none',
          width: '100%',
        }}
        value={title}
        variant={'borderless'}
      />
    </Flexbox>
  );
});

export default TitleSection;
