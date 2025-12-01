'use client';

import { ActionIcon, Tooltip } from '@lobehub/ui';
import { Popover } from 'antd';
import { createStyles } from 'antd-style';
import { SmilePlus } from 'lucide-react';
import { type FC, type ReactNode, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const QUICK_REACTIONS = ['👍', '👎', '❤️', '😄', '🎉', '😢', '🤔', '🚀'];

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
  pickerContainer: css`
    padding: 8px;
  `,
}));

interface ReactionPickerProps {
  /**
   * Callback when an emoji is selected
   */
  onSelect: (emoji: string) => void;
  /**
   * Custom trigger element
   */
  trigger?: ReactNode;
}

const ReactionPicker: FC<ReactionPickerProps> = memo(({ onSelect, trigger }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  const handleSelect = (emoji: string) => {
    onSelect(emoji);
    setOpen(false);
  };

  const content = (
    <Flexbox className={styles.pickerContainer} gap={4} horizontal wrap="wrap">
      {QUICK_REACTIONS.map((emoji) => (
        <div className={styles.emojiButton} key={emoji} onClick={() => handleSelect(emoji)}>
          {emoji}
        </div>
      ))}
    </Flexbox>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={setOpen}
      open={open}
      placement="top"
      trigger="click"
    >
      {trigger || (
        <Tooltip title={t('messageAction.reaction')}>
          <ActionIcon icon={SmilePlus} size="small" />
        </Tooltip>
      )}
    </Popover>
  );
});

ReactionPicker.displayName = 'ReactionPicker';

export default ReactionPicker;
