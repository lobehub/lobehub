import { createStaticStyles, Flexbox, Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { dataSelectors, useConversationStore } from '../../../store';
import UserMessageContent from '../../User/components/MessageContent';

const styles = createStaticStyles(({ css, cssVar }) => ({
  bubble: css`
    max-width: 100%;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 12px;

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface SteerMessageProps {
  id: string;
}

const SteerMessage = memo<SteerMessageProps>(({ id }) => {
  const { t } = useTranslation('chat');
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);

  if (!item) return null;

  return (
    <Flexbox align={'flex-end'} data-message-id={id} data-steer-message={id}>
      <Flexbox align={'flex-start'} className={styles.bubble} gap={4}>
        <Tag>{t('steer.tag')}</Tag>
        <UserMessageContent {...item} />
      </Flexbox>
    </Flexbox>
  );
});

SteerMessage.displayName = 'SteerMessage';

export default SteerMessage;
