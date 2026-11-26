import { ActionIcon } from '@lobehub/ui';
import { ArrowRight } from 'lucide-react';
import { memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useOpenActiveAgentTopics } from './hooks/useTopicNavigation';

/**
 * Header entry to the agent's full topic page (`/agent/:aid/topics`), the same
 * arrow the home sidebar's Agents section uses for its view-all page.
 */
const ViewAllAction = memo(() => {
  const { t } = useTranslation('chat');
  const openTopics = useOpenActiveAgentTopics();

  if (!openTopics) return null;

  return (
    <ActionIcon
      icon={ArrowRight}
      size={'small'}
      title={t('topic.viewAll')}
      onClick={(e: MouseEvent) => {
        // Stop the click from toggling the accordion header.
        e.stopPropagation();
        openTopics();
      }}
    />
  );
});

ViewAllAction.displayName = 'TopicViewAllAction';

export default ViewAllAction;
