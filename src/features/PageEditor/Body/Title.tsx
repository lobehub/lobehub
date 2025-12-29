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

import { usePageEditorStore } from '../store';

const Title = memo(() => {
  const { t } = useTranslation('file');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const currentEmoji = usePageEditorStore((s) => s.currentEmoji);
  const currentTitle = usePageEditorStore((s) => s.currentTitle);
  const setCurrentEmoji = usePageEditorStore((s) => s.setCurrentEmoji);
  const setCurrentTitle = usePageEditorStore((s) => s.setCurrentTitle);
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
      {(currentEmoji || showEmojiPicker) && (
        <EmojiPicker
          allowDelete
          locale={locale}
          onChange={(emoji) => {
            setCurrentEmoji(emoji);
            setShowEmojiPicker(false);
          }}
          onDelete={() => {
            setCurrentEmoji(undefined);
            setShowEmojiPicker(false);
          }}
          onOpenChange={(open) => {
            setShowEmojiPicker(open);
          }}
          open={showEmojiPicker}
          shape={'square'}
          size={72}
          title={t('pageEditor.chooseIcon')}
          value={currentEmoji}
        />
      )}

      {/* Choose Icon button - only shown when no emoji */}
      {!currentEmoji && !showEmojiPicker && (
        <Button
          icon={<Icon icon={SmilePlus} />}
          onClick={() => {
            setCurrentEmoji('📄');
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
          setCurrentTitle(truncated);
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
        value={currentTitle}
        variant={'borderless'}
      />
    </Flexbox>
  );
});

export default Title;
