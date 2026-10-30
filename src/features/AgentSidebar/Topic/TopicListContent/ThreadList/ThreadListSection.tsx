import { Flexbox, Select } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sectionStyles } from '@/features/Conversation/WorkingSidebar/Overview/sectionStyles';
import { useSubagentPresets } from '@/hooks/useSubagentPresets';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import { getThreadListHeadingKey } from './heading';
import ThreadList from './index';
import type { SubagentFilter } from './subagentFilter';
import { collectSubagentIds, SUBAGENT_FILTER_ALL, SUBAGENT_FILTER_MAIN } from './subagentFilter';

/**
 * Right working-panel presentation of a topic's thread list: a section heading
 * over the rows. The heading says "Subagents" only when every row is one.
 * When any thread was run by a subagent preset, the header also offers a
 * filter by preset and each row names the preset that ran it.
 *
 * The mobile topic list uses `ThreadList` directly instead — it has no room for
 * a section header and nests the rows under the topic row.
 */
const ThreadListSection = memo(({ topicId }: { topicId: string }) => {
  const { t } = useTranslation('chat');
  const threads = useChatStore(threadSelectors.getThreadsByTopic(topicId));
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const [filter, setFilter] = useState<SubagentFilter>(SUBAGENT_FILTER_ALL);

  const subagentIds = useMemo(() => collectSubagentIds(threads ?? []), [threads]);
  const { data: presets } = useSubagentPresets(activeAgentId, subagentIds.length > 0);

  const subagentNames = useMemo(() => {
    // Without a response nothing is known about the presets: show plain rows, not fallback labels.
    if (!presets) return;
    const names = new Map(presets.map((preset) => [preset.id, preset.name]));
    for (const id of subagentIds) {
      if (!names.has(id)) names.set(id, t('workingPanel.overview.subagentFilter.unknown'));
    }
    return names;
  }, [presets, subagentIds, t]);

  if (!threads || threads.length === 0) return;

  // A preset filter whose threads are gone falls back to the full list.
  const hasMainThreads = threads.some((thread) => !thread.subagentId);
  const activeFilter =
    filter === SUBAGENT_FILTER_ALL ||
    (filter === SUBAGENT_FILTER_MAIN && hasMainThreads) ||
    (presets && subagentIds.includes(filter))
      ? filter
      : SUBAGENT_FILTER_ALL;

  return (
    <Flexbox className={sectionStyles.section}>
      <Flexbox
        horizontal
        align={'center'}
        className={sectionStyles.sectionHeader}
        justify={'space-between'}
      >
        <span className={sectionStyles.sectionTitle} style={{ flexShrink: 0 }}>
          {t(getThreadListHeadingKey(threads))}
        </span>
        {subagentNames && subagentIds.length > 0 && (
          // `Select` does not forward `aria-label`, so name the control through a group.
          <div aria-label={t('workingPanel.overview.subagentFilter.label')} role={'group'}>
            <Select
              popupMatchSelectWidth={false}
              size={'small'}
              style={{ flex: 'none', maxWidth: 160, width: 'auto' }}
              value={activeFilter}
              variant={'borderless'}
              options={[
                {
                  label: t('workingPanel.overview.subagentFilter.all'),
                  value: SUBAGENT_FILTER_ALL,
                },
                ...(hasMainThreads
                  ? [
                      {
                        label: t('workingPanel.overview.subagentFilter.main'),
                        value: SUBAGENT_FILTER_MAIN,
                      },
                    ]
                  : []),
                ...subagentIds.map((id) => ({ label: subagentNames.get(id), value: id })),
              ]}
              onChange={setFilter}
            />
          </div>
        )}
      </Flexbox>
      <ThreadList filter={activeFilter} subagentNames={subagentNames} topicId={topicId} />
    </Flexbox>
  );
});

ThreadListSection.displayName = 'ThreadListSection';

export default ThreadListSection;
