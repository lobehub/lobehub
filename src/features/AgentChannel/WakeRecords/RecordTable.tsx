'use client';

import type { BotWakeUserLabel } from '@lobechat/types';
import { ActionIcon, Flexbox, Table, type TableColumn, Tag, Text, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WakeDecisionItem } from '@/services/agentBotProvider';

import { MarkButtons } from './MarkButtons';
import { platformMessageUrl } from './messageLink';

const OUTCOME_COLOR: Record<string, string> = {
  defer: 'processing',
  skip: 'default',
  wake: 'success',
};

const styles = stylex.create({
  preview: {
    flex: '1',
    minWidth: 0,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
});

interface RecordTableProps {
  disabled?: boolean;
  items: WakeDecisionItem[];
  onMark: (decisionId: string, label: BotWakeUserLabel | null) => Promise<void>;
}

/**
 * One row per judged message: when, what it said (with a link to it on the platform), what the
 * bot did and why, and the owner's ✓ / ✗ mark.
 */
export const RecordTable = ({ disabled, items, onMark }: RecordTableProps) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string, options?: Record<string, unknown>) => string;
  // The pipeline's vocabulary grows; a reason this build has no copy for shows as recorded.
  const translate = (group: string, value: string) =>
    t(`channel.records.${group}.${value}`, { defaultValue: value });

  const columns: TableColumn<WakeDecisionItem>[] = [
    {
      dataIndex: 'createdAt',
      key: 'time',
      render: (_, item) => {
        const at = dayjs(item.createdAt);
        return (
          <Tooltip title={at.format('YYYY-MM-DD HH:mm:ss')}>
            <Text fontSize={12} style={{ whiteSpace: 'nowrap' }} type={'secondary'}>
              {at.format('MM-DD HH:mm')}
            </Text>
          </Tooltip>
        );
      },
      title: t('channel.records.column.time'),
      width: 96,
    },
    {
      key: 'message',
      render: (_, item) => {
        const url = platformMessageUrl(item.address);
        return (
          <Flexbox horizontal align={'center'} gap={4}>
            {item.text ? (
              <Text
                ellipsis={{ rows: 2, tooltipWhenOverflow: true }}
                {...stylex.props(styles.preview)}
              >
                {item.text}
              </Text>
            ) : (
              <Tooltip title={t('channel.records.purgedHint')}>
                <Text italic type={'secondary'} {...stylex.props(styles.preview)}>
                  {t('channel.records.purged')}
                </Text>
              </Tooltip>
            )}
            {url && (
              <a
                aria-label={t('channel.records.openMessage')}
                href={url}
                rel={'noopener noreferrer'}
                target={'_blank'}
              >
                <ActionIcon
                  icon={ExternalLink}
                  size={'small'}
                  title={t('channel.records.openMessage')}
                />
              </a>
            )}
          </Flexbox>
        );
      },
      title: t('channel.records.column.message'),
    },
    {
      key: 'outcome',
      render: (_, item) => (
        <Flexbox horizontal gap={4} wrap={'wrap'}>
          <Tag color={OUTCOME_COLOR[item.outcome]} size={'small'}>
            {translate('outcome', item.outcome)}
          </Tag>
          {item.followup && <Tag size={'small'}>{t('channel.records.proactive')}</Tag>}
        </Flexbox>
      ),
      title: t('channel.records.column.outcome'),
      width: 124,
    },
    {
      key: 'reason',
      render: (_, item) => (
        <Flexbox gap={2}>
          <Text fontSize={12}>
            {item.finalReason ? translate('reason', item.finalReason) : '--'}
          </Text>
          {item.agentLabel && (
            <Text fontSize={12} type={'secondary'}>
              {item.agentLabel.reason
                ? t('channel.records.silencedWithReason', {
                    reason: translate('noReplyReason', item.agentLabel.reason),
                  })
                : t('channel.records.silenced')}
            </Text>
          )}
        </Flexbox>
      ),
      title: t('channel.records.column.reason'),
      width: 208,
    },
    {
      align: 'center',
      key: 'mark',
      render: (_, item) => (
        <MarkButtons
          current={item.userLabel?.label as BotWakeUserLabel | undefined}
          disabled={disabled}
          outcome={item.outcome}
          onMark={(label) => onMark(item.id, label)}
        />
      ),
      title: t('channel.records.column.mark'),
      width: 84,
    },
  ];

  return (
    <Table<WakeDecisionItem>
      columns={columns}
      dataSource={items}
      pagination={false}
      rowKey={'id'}
      size={'small'}
    />
  );
};
