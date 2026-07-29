import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type BriefItem } from '@/features/DailyBrief/types';
import RailCard from '@/features/Home/components/RailCard';

import InboxBriefCard from './InboxBriefCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  pager: css`
    padding-inline: 2px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/**
 * In the rail the actionable briefs are stacked, not listed: one at a time with
 * a pager, so a pile of five decisions still costs the same vertical space as
 * one and the rail below it stays reachable.
 */
const NeedsYouRailCard = memo<{ briefs: BriefItem[]; scopeControl?: ReactNode }>(
  ({ briefs, scopeControl }) => {
    const { t } = useTranslation('home');
    const [index, setIndex] = useState(0);

    // Resolving a brief drops it from the list, so the held index can outrun it.
    const current = Math.min(index, briefs.length - 1);
    const brief = briefs[current];

    return (
      <RailCard
        title={t('inbox.needsYou.title')}
        action={
          scopeControl || briefs.length > 1 ? (
            <Flexbox horizontal align={'center'} gap={4}>
              {scopeControl}
              {briefs.length > 1 && (
                <>
                  <ActionIcon
                    disabled={current === 0}
                    icon={ChevronLeftIcon}
                    size={'small'}
                    onClick={() => setIndex(current - 1)}
                  />
                  <span className={styles.pager}>
                    {current + 1}/{briefs.length}
                  </span>
                  <ActionIcon
                    disabled={current === briefs.length - 1}
                    icon={ChevronRightIcon}
                    size={'small'}
                    onClick={() => setIndex(current + 1)}
                  />
                </>
              )}
            </Flexbox>
          ) : null
        }
      >
        <InboxBriefCard bare brief={brief} key={brief.id} />
      </RailCard>
    );
  },
);

export default NeedsYouRailCard;
