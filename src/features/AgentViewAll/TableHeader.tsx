'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ACTION_COL_WIDTH, AUTHOR_COL_WIDTH, TIME_COL_WIDTH } from './AgentRow';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    padding-block: 4px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface TableHeaderProps {
  showAuthor?: boolean;
}

// Plain column labels — ordering lives in the display-config popover, so the
// header carries no sort affordance.
const TableHeader = memo<TableHeaderProps>(({ showAuthor }) => {
  const { t } = useTranslation('common');

  return (
    <Flexbox horizontal align={'center'} className={styles.header} gap={12}>
      <Flexbox flex={1}>
        <Text fontSize={12} type={'secondary'}>
          {t('agentViewAll.columns.name')}
        </Text>
      </Flexbox>
      {showAuthor && (
        <Flexbox flex={'none'} style={{ width: AUTHOR_COL_WIDTH }}>
          <Text fontSize={12} type={'secondary'}>
            {t('agentViewAll.columns.author')}
          </Text>
        </Flexbox>
      )}
      <Flexbox flex={'none'} style={{ width: TIME_COL_WIDTH }}>
        <Text fontSize={12} type={'secondary'}>
          {t('agentViewAll.columns.updatedAt')}
        </Text>
      </Flexbox>
      {/* Action column keeps its width but shows no label. */}
      <div style={{ flex: 'none', width: ACTION_COL_WIDTH }} />
    </Flexbox>
  );
});

TableHeader.displayName = 'AgentViewAllTableHeader';

export default TableHeader;
