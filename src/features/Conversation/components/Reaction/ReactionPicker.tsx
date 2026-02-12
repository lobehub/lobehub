'use client';

import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { ActionIcon, Flexbox, Tooltip } from '@lobehub/ui';
import { Popover } from 'antd';
import { createStyles, useTheme } from 'antd-style';
import { PlusIcon, SmilePlus } from 'lucide-react';
import { type FC, type ReactNode, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { useConversationStore } from '../../store';

const QUICK_REACTIONS = ['👍', '👎', '❤️', '😄', '😂', '😅', '🎉', '😢', '🤔', '🚀'];

const useStyles = createStyles(({ css, token }) => ({
  emojiButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${token.borderRadius}px;

    font-size: 18px;

    transition: all 0.2s;

    &:hover {
      transform: scale(1.1);
      background: ${token.colorFillSecondary};
    }
  `,
  moreButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${token.borderRadius}px;

    color: ${token.colorTextTertiary};

    transition: all 0.2s;

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFillSecondary};
    }
  `,
  pickerContainer: css`
    padding: 4px;
  `,
}));

interface ReactionPickerProps {
  messageId: string;
  trigger?: ReactNode;
}

const ReactionPicker: FC<ReactionPickerProps> = memo(({ messageId, trigger }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('chat');
  const theme = useTheme();
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const addReaction = useConversationStore((s) => s.addReaction);
  const [open, setOpen] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);

  const handleSelect = (emoji: string) => {
    addReaction(messageId, emoji);
    setOpen(false);
    setShowFullPicker(false);
  };

  const handleOpenChange = (visible: boolean) => {
    setOpen(visible);
    if (!visible) setShowFullPicker(false);
  };

  const content = showFullPicker ? (
    <Picker
      data={data}
      locale={locale?.split('-')[0] || 'en'}
      onEmojiSelect={(emoji: any) => handleSelect(emoji.native)}
      previewPosition="none"
      skinTonePosition="none"
      theme={theme.appearance === 'dark' ? 'dark' : 'light'}
    />
  ) : (
    <Flexbox className={styles.pickerContainer} gap={4} horizontal wrap="wrap">
      {QUICK_REACTIONS.map((emoji) => (
        <div className={styles.emojiButton} key={emoji} onClick={() => handleSelect(emoji)}>
          {emoji}
        </div>
      ))}
      <div className={styles.moreButton} onClick={() => setShowFullPicker(true)}>
        <PlusIcon size={16} />
      </div>
    </Flexbox>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={handleOpenChange}
      open={open}
      overlayInnerStyle={{ padding: 0 }}
      placement="top"
      trigger="click"
    >
      {trigger || (
        <span {...(open ? { 'data-popup-open': '' } : {})}>
          <Tooltip title={t('messageAction.reaction')}>
            <ActionIcon icon={SmilePlus} size="small" />
          </Tooltip>
        </span>
      )}
    </Popover>
  );
});

ReactionPicker.displayName = 'ReactionPicker';

export default ReactionPicker;
