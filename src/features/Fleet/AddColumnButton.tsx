'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeAgentSelector from '@/features/AgentTasks/features/AssigneeAgentSelector';
import { topicService } from '@/services/topic';

import { useFleetStore } from './store';
import { fleetColumnKey } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    align-items: flex-start;
    justify-content: center;

    width: 52px;
    height: 100%;
    padding-block-start: 12px;

    color: ${cssVar.colorTextTertiary};

    transition: color 0.15s;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

/**
 * Trailing "+" at the right edge of the board. Opens an agent picker; selecting
 * an agent creates a fresh topic for it and opens it as a new column ready to
 * receive messages.
 */
const AddColumnButton = memo(() => {
  const { t } = useTranslation(['electron', 'topic']);
  const addColumn = useFleetStore((s) => s.addColumn);

  const handleSelectAgent = useCallback(
    async (agentId: string) => {
      const title = t('defaultTitle', { ns: 'topic' });
      const topicId = await topicService.createTopic({ messages: [], sessionId: agentId, title });
      const key = fleetColumnKey(agentId, topicId);
      addColumn({ agentId, fallbackTitle: title, key, threadId: null, topicId });
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-fleet-col="${CSS.escape(key)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
      });
    },
    [addColumn, t],
  );

  return (
    <AssigneeAgentSelector onChange={handleSelectAgent}>
      <div className={styles.trigger} title={t('fleet.addColumn')}>
        <Icon icon={PlusIcon} size={20} />
      </div>
    </AssigneeAgentSelector>
  );
});

AddColumnButton.displayName = 'FleetAddColumnButton';

export default AddColumnButton;
