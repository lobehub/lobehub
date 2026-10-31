import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

// Longhand StyleX rules outrank lobe-ui's layered Button styles, replacing the
// former `&&` specificity bump.
const styles = stylex.create({
  button: {
    gap: '4px',
    paddingInline: '6px',
    borderRadius: cssVar.borderRadiusXS,
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorTextSecondary,
      ':active': cssVar.colorText,
    },
    backgroundColor: {
      'default': null,
      ':hover': cssVar.colorFillTertiary,
      ':active': cssVar.colorFillTertiary,
    },
    backgroundImage: { 'default': null, ':hover': 'none', ':active': 'none' },
  },
  container: {
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

interface MessageCommentBadgeProps {
  count: number;
  messageId: string;
  topicId: string;
}

const MessageCommentBadge = memo<MessageCommentBadgeProps>(({ count, messageId, topicId }) => {
  const { t } = useTranslation('chat');
  const openTopicComments = useChatStore((s) => s.openTopicComments);
  const label = t('topicComment.openMessageComments', { count });

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.container).className}
      flex={'none'}
      padding={2}
    >
      <Button
        aria-label={label}
        className={stylex.props(styles.button).className}
        icon={MessageCircle}
        size={'small'}
        title={label}
        type={'text'}
        onClick={() => openTopicComments(topicId, messageId)}
      >
        {count > 99 ? '99+' : count}
      </Button>
    </Flexbox>
  );
});

MessageCommentBadge.displayName = 'MessageCommentBadge';

export default MessageCommentBadge;
