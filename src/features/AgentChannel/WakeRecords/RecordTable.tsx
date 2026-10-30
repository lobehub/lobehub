'use client';

import type { BotWakeUserLabel } from '@lobechat/types';
import { ActionIcon, Flexbox, Table, type TableColumn, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WakeDecisionItem } from '@/services/agentBotProvider';

import { MarkButtons } from './MarkButtons';
import { platformMessageUrl } from './messageLink';

const HOVER = '@media (hover: hover)';

const OUTCOME_DOT: Record<string, string> = {
  defer: cssVar.colorInfo,
  skip: cssVar.colorTextQuaternary,
  wake: cssVar.colorSuccess,
};

const styles = stylex.create({
  dot: (color: string) => ({
    backgroundColor: color,
    borderRadius: '50%',
    flexShrink: 0,
    height: 6,
    width: 6,
  }),
  // Shown on a pointer device only while the row is hovered or focused; always on touch.
  link: {
    opacity: {
      default: 1,
      [HOVER]: {
        default: 0,
        [stylex.when.ancestor(':hover')]: 1,
        [stylex.when.ancestor(':focus-within')]: 1,
      },
    },
  },
  score: {
    fontVariantNumeric: 'tabular-nums',
  },
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
 * One row per judged message: when, what it said (with a link to it on the platform, shown on
 * hover), what the bot did, the model score behind it, why, and the owner's ✓ / ✗ mark.
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
                {...stylex.props(styles.link)}
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
        <Flexbox horizontal align={'center'} gap={6}>
          <span
            {...stylex.props(styles.dot(OUTCOME_DOT[item.outcome] ?? cssVar.colorTextQuaternary))}
          />
          <Text fontSize={12} style={{ whiteSpace: 'nowrap' }}>
            {translate('outcome', item.outcome)}
            {item.followup && (
              <Text as={'span'} fontSize={12} type={'secondary'}>
                {` · ${t('channel.records.proactive')}`}
              </Text>
            )}
          </Text>
        </Flexbox>
      ),
      title: t('channel.records.column.outcome'),
      width: 116,
    },
    {
      align: 'right',
      key: 'score',
      render: (_, item) =>
        item.judge ? (
          <Tooltip
            title={t('channel.records.judge.hint', {
              judge: t(`channel.records.judge.${item.judge.kind}`),
              verdict: t(`channel.records.judge.${item.judge.verdict}`, {
                defaultValue: item.judge.verdict,
              }),
            })}
          >
            <Text fontSize={12} {...stylex.props(styles.score)}>
              {item.judge.score.toFixed(2)}
            </Text>
          </Tooltip>
        ) : (
          <Text fontSize={12} type={'secondary'}>
            --
          </Text>
        ),
      title: t('channel.records.column.score'),
      width: 72,
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
      // Each row marks itself so the message link can show on hovering it.
      onRow={() => stylex.props(stylex.defaultMarker())}
    />
  );
};
