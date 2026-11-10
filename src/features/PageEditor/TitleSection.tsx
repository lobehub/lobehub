'use client';

import { Button, cssVar, Flexbox, Icon, Skeleton, TextArea } from '@lobehub/ui';
import { SmilePlus } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { PAGE_TITLE_INPUT_ATTRIBUTE } from './titleBodyNavigation';
import { usePageTitleInteractions } from './usePageTitleInteractions';

export { isTitleSubmitKey } from './usePageTitleInteractions';

export const getTitleTextAreaInteractionProps = (canEdit: boolean) => ({
  readOnly: !canEdit,
});

const TitleSection = memo(() => {
  const { t } = useTranslation('file');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const containerRef = useRef<HTMLDivElement>(null);
  const { canEdit, emojiPicker, handleTitleChange, handleTitleKeyDown, showTitleSkeleton, title } =
    usePageTitleInteractions(containerRef);

  const [isHoveringTitle, setIsHoveringTitle] = useState(false);

  return (
    <Flexbox
      gap={16}
      paddingBlock={16}
      ref={containerRef}
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
      {emojiPicker.visible && (
        <EmojiPicker
          allowDelete
          locale={locale}
          open={emojiPicker.open}
          shape={'square'}
          size={72}
          title={t('pageEditor.chooseIcon')}
          value={emojiPicker.value}
          onChange={emojiPicker.onChange}
          onDelete={emojiPicker.onDelete}
          onOpenChange={emojiPicker.onOpenChange}
        />
      )}

      {/* Choose Icon button - only shown when no emoji */}
      {!emojiPicker.visible && (
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
          onClick={emojiPicker.onOpen}
        >
          {t('pageEditor.chooseIcon')}
        </Button>
      )}

      {/* Title Input */}
      {showTitleSkeleton ? (
        <Skeleton height={44} width={320} />
      ) : (
        <TextArea
          autoSize={{ minRows: 1 }}
          placeholder={t('pageEditor.titlePlaceholder')}
          {...getTitleTextAreaInteractionProps(canEdit)}
          {...{ [PAGE_TITLE_INPUT_ATTRIBUTE]: true }}
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
          onChange={handleTitleChange}
          onKeyDown={handleTitleKeyDown}
        />
      )}
    </Flexbox>
  );
});

export default TitleSection;
