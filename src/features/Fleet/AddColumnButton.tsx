'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeAgentSelector from '@/features/AgentTasks/features/AssigneeAgentSelector';

import { useFleetStore } from './store';
import { fleetColumnKey } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 52px;
    height: 100%;

    color: ${cssVar.colorTextTertiary};

    transition: color 0.15s;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

interface AddColumnButtonProps {
  /** Splice the new column right after this key (a band's "+" adds to its row). */
  insertAfterKey?: string;
  /** Band index to drop the new column into (a band's "+" passes its own row). */
  row?: number;
}

/**
 * Trailing "+" at the end of a band. Opens an agent picker; selecting an agent
 * opens that agent's main conversation (its existing default topic) as a column.
 * Re-selecting an already-open agent just focuses/scrolls to its column instead
 * of spawning a duplicate (the column key dedupes on `agentId::default`).
 * In multi-band mode each band carries its own, adding into that row.
 */
const AddColumnButton = memo<AddColumnButtonProps>(({ insertAfterKey, row }) => {
  const { t } = useTranslation(['electron', 'topic']);
  const addColumn = useFleetStore((s) => s.addColumn);

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      // Open the agent's main conversation (topicId: null) as a fresh chat —
      // "pick an agent" here means "start a new conversation with this agent",
      // not "mint an empty throwaway topic". Instant (no server round-trip that
      // could silently fail) and dedupes so re-picking just focuses the column.
      const key = fleetColumnKey(agentId, null);
      addColumn(
        {
          agentId,
          fallbackTitle: t('defaultTitle', { ns: 'topic' }),
          key,
          threadId: null,
          topicId: null,
        },
        insertAfterKey,
        row,
      );
      // Scroll after the column commits to the DOM. Double rAF so the query runs
      // post-render (a single frame can fire before React paints the new column).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-fleet-col="${CSS.escape(key)}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
        });
      });
    },
    [addColumn, insertAfterKey, row, t],
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
