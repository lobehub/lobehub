import { Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { HistoryIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';

const SearchTag = memo(() => {
  const { t } = useTranslation('chat');
  const historyCount = useAgentStore(agentChatConfigSelectors.historyCount);

  return (
    <Tooltip title={t('history.title', { count: historyCount })}>
      <Flexbox height={22}>
        <Tag>
          <Icon icon={HistoryIcon} />
          <span>{historyCount}</span>
        </Tag>
      </Flexbox>
    </Tooltip>
  );
});

export default SearchTag;
