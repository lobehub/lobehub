'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The visitor's topic list under the current share.
 *
 * C1 ships the layout only — the share-scoped topic APIs land with C3, so the
 * list always renders its empty state for now.
 */
const TopicPanel = memo<{ showTitle?: boolean }>(({ showTitle = true }) => {
  const { t } = useTranslation('agent');

  return (
    <Flexbox gap={8} height={'100%'} padding={12} style={{ overflowY: 'auto' }}>
      {showTitle && (
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('share.visitor.topics.title')}
        </Text>
      )}
      <Center flex={1}>
        <Text fontSize={12} type={'secondary'}>
          {t('share.visitor.topics.empty')}
        </Text>
      </Center>
    </Flexbox>
  );
});

TopicPanel.displayName = 'ShareVisitorTopicPanel';

export default TopicPanel;
