import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { MessageCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    && {
      gap: 4px;
      padding-inline: 6px;
      border-radius: ${cssVar.borderRadiusXS};
      color: ${cssVar.colorTextTertiary};
    }

    &&:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }

    &&:active {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  container: css`
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};
  `,
}));

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
    <Flexbox horizontal align={'center'} className={styles.container} flex={'none'} padding={2}>
      <Button
        aria-label={label}
        className={styles.button}
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
