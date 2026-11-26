import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, type RefObject, useId } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import type { AssistantMarketSource } from '@/types/discover';

import type { MarketAgentSummary } from './marketAgentCatalog';
import MarketAgentRow from './MarketAgentRow';

export const agentGridStyles = stylex.create({
  cards: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(3, minmax(0, 1fr))',
      '@media (max-width: 720px)': 'minmax(0, 1fr)',
    },
    gap: 12,
  },
  divider: {
    height: 1,
    backgroundColor: cssVar.colorBorderSecondary,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(2, minmax(0, 1fr))',
      '@media (max-width: 720px)': 'minmax(0, 1fr)',
    },
    columnGap: 16,
    rowGap: 4,
  },
});

const styles = stylex.create({
  more: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: 0,
    borderWidth: 0,
    font: 'inherit',
    fontSize: 13,
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorTextSecondary,
    },
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
});

/**
 * A titled block: a rule, the title with its count, and "View all" when there
 * is more — a button (`onMore`) or a link to the full list (`to`).
 */
export const AgentSection = ({
  children,
  count,
  onMore,
  sectionRef,
  title,
  to,
}: {
  children: ReactNode;
  count?: number;
  onMore?: () => void;
  sectionRef?: RefObject<HTMLElement | null>;
  title: string;
  to?: string;
}) => {
  const { t } = useTranslation('discover');
  const id = useId();
  const more = (
    <>
      {t('catalog.viewAll')}
      <Icon icon={ChevronRight} size={14} />
    </>
  );
  return (
    <Flexbox aria-labelledby={id} as={'section'} gap={8} ref={sectionRef}>
      <div {...stylex.props(agentGridStyles.divider)} />
      <Flexbox horizontal align={'center'} justify={'space-between'} paddingBlock={8}>
        <Flexbox horizontal align={'baseline'} gap={8}>
          <Text as={'h2'} fontSize={14} id={id} weight={600}>
            {title}
          </Text>
          {count !== undefined && <Text type={'secondary'}>{count}</Text>}
        </Flexbox>
        {to ? (
          <WorkspaceLink to={to} {...stylex.props(styles.more)}>
            {more}
          </WorkspaceLink>
        ) : (
          onMore && (
            <button type={'button'} {...stylex.props(styles.more)} onClick={onMore}>
              {more}
            </button>
          )
        )}
      </Flexbox>
      {children}
    </Flexbox>
  );
};

/** Agent rows in the two-column grid every Marketplace Agent list uses. */
export const AgentGrid = memo<{ agents: MarketAgentSummary[]; source?: AssistantMarketSource }>(
  ({ agents, source }) => (
    <div {...stylex.props(agentGridStyles.grid)}>
      {agents.map((agent) => (
        <MarketAgentRow agent={agent} key={agent.id} source={source} />
      ))}
    </div>
  ),
);

AgentGrid.displayName = 'MarketplaceAgentGrid';
