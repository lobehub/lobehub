'use client';

import type { InboundWebhookItem } from '@lobechat/types';
import { Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ZapIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';

import AutomationStatus from './AutomationStatus';
import { LastDeliveryCell, SubscriptionCell, TargetCell } from './cells';
import { COLUMN_WIDTH } from './columnWidth';
import RowActions from './RowActions';
import { useAutomationList } from './useAutomationList';

const styles = stylex.create({
  // Same surface as the API key list: one frame, the table flush inside it.
  container: {
    overflow: 'hidden',
    paddingBlock: '16px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  header: {
    paddingBlockEnd: '16px',
    paddingInline: '24px',
  },
});

/**
 * Everything that runs an agent without the user present, and whether each
 * one still works.
 *
 * Rows are created by agents in conversation (with the user's approval), so
 * the page has no create action; it answers "what is firing my agents, is it
 * healthy, where does it land" and lets the user check or stop one.
 */
const AutomationList = memo(() => {
  const { t } = useTranslation('setting');
  const activeWorkspaceId = useActiveWorkspaceId();

  const { data, error, isLoading, reload, removeRow, replaceRow } = useAutomationList();

  const columns: LiteTableColumn<InboundWebhookItem>[] = [
    {
      key: 'subscription',
      listSlot: 'title',
      render: (item) => <SubscriptionCell item={item} />,
      title: t('automations.columns.subscription'),
    },
    {
      key: 'status',
      render: (item) => <AutomationStatus item={item} />,
      title: t('automations.columns.status'),
      width: COLUMN_WIDTH.status,
    },
    {
      key: 'target',
      render: (item) => <TargetCell item={item} />,
      title: t('automations.columns.target'),
      width: COLUMN_WIDTH.target,
    },
    {
      key: 'lastDelivery',
      render: (item) => <LastDeliveryCell at={item.lastDeliveryAt} />,
      title: t('automations.columns.lastDelivery'),
      width: COLUMN_WIDTH.lastDelivery,
    },
    {
      key: 'actions',
      // Beside the name in the narrow card layout, not under the facts.
      listSlot: 'extra',
      render: (item) => <RowActions item={item} onChecked={replaceRow} onRemoved={removeRow} />,
      title: '',
      width: COLUMN_WIDTH.actions,
    },
  ];

  const rows = data ?? [];

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.header)}>
        <Text style={{ fontSize: 13 }} type={'secondary'}>
          {t(activeWorkspaceId ? 'automations.descWorkspace' : 'automations.desc')}
        </Text>
      </div>
      <AsyncBoundary
        data={data}
        error={error}
        errorVariant={'block'}
        isEmpty={rows.length === 0}
        isLoading={isLoading}
        empty={
          <Center height={240} width={'100%'}>
            <Empty
              description={t('automations.empty.desc')}
              // The default 34ch cap breaks the one-sentence CJK copy mid-word.
              descriptionProps={{ style: { maxWidth: '48ch' } }}
              icon={ZapIcon}
              title={t('automations.empty.title')}
            />
          </Center>
        }
        loading={
          <LiteTable
            loading
            columns={columns}
            listBreakpoint={800}
            rowKey={(item) => item.id}
            tableLayout={'fixed'}
          />
        }
        onRetry={() => void reload()}
      >
        <Flexbox>
          <LiteTable
            columns={columns}
            dataSource={rows}
            listBreakpoint={800}
            rowKey={(item) => item.id}
            tableLayout={'fixed'}
          />
        </Flexbox>
      </AsyncBoundary>
    </div>
  );
});

AutomationList.displayName = 'AutomationList';

export default AutomationList;
