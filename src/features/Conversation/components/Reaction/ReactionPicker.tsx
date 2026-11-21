'use client';

import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { ActionIcon, Flexbox, Popover, Tooltip, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlusIcon, SmilePlus } from 'lucide-react';
import { type FC, memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { useConversationResourceAccess } from '../../hooks/useConversationResourceAccess';
import { useConversationStore } from '../../store';

const QUICK_REACTIONS = ['👍', '👎', '❤️', '😄', '😂', '😅', '🎉', '😢', '🤔', '🚀'];

const styles = stylex.create({
  emojiButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: cssVar.borderRadius,
    fontSize: '18px',
    transition: 'all 0.2s',
    transform: { 'default': null, ':hover': 'scale(1.1)' },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  moreButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: cssVar.borderRadius,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  pickerContainer: { padding: '4px' },
});

interface ReactionPickerProps {
  messageId: string;
  trigger?: ReactNode;
}

const ReactionPicker: FC<ReactionPickerProps> = memo(({ messageId, trigger }) => {
  const { t } = useTranslation('chat');
  const theme = useTheme();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { canUseResource } = useConversationResourceAccess();
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const addReaction = useConversationStore((s) => s.addReaction);
  const [open, setOpen] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);

  // Reactions write to the shared conversation — view-only members don't get
  // the affordance (same absent-when-not-applicable rule as message actions).
  if (!canEdit || !canUseResource) return null;

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
      previewPosition="none"
      skinTonePosition="none"
      theme={theme.appearance === 'dark' ? 'dark' : 'light'}
      onEmojiSelect={(emoji: any) => handleSelect(emoji.native)}
    />
  ) : (
    <Flexbox
      horizontal
      className={stylex.props(styles.pickerContainer).className}
      gap={4}
      wrap="wrap"
    >
      {QUICK_REACTIONS.map((emoji) => (
        <div {...stylex.props(styles.emojiButton)} key={emoji} onClick={() => handleSelect(emoji)}>
          {emoji}
        </div>
      ))}
      <div {...stylex.props(styles.moreButton)} onClick={() => setShowFullPicker(true)}>
        <PlusIcon size={16} />
      </div>
    </Flexbox>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      open={open}
      placement="top"
      styles={{ content: { padding: 0 } }}
      trigger="click"
      onOpenChange={handleOpenChange}
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
