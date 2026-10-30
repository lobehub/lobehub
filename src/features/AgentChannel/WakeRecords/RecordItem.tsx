'use client';

import type { BotWakeUserLabel } from '@lobechat/types';
import { Flexbox, Tag, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import type { WakeDecisionItem } from '@/services/agentBotProvider';

import { MarkButtons } from './MarkButtons';

const OUTCOME_COLOR: Record<string, string> = {
  defer: 'processing',
  skip: 'default',
  wake: 'success',
};

const styles = stylex.create({
  preview: {
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  row: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    paddingBlock: 12,
    paddingInline: 16,
  },
});

interface RecordItemProps {
  disabled?: boolean;
  item: WakeDecisionItem;
  onMark: (decisionId: string, label: BotWakeUserLabel) => Promise<void>;
}

/** One judged message: when, what it said, what the bot did and why, and the owner's mark. */
export const RecordItem = ({ disabled, item, onMark }: RecordItemProps) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string, options?: Record<string, unknown>) => string;
  // The pipeline's vocabulary grows; a reason this build has no copy for shows as recorded.
  const translate = (group: string, value: string) =>
    t(`channel.records.${group}.${value}`, { defaultValue: value });
  const at = dayjs(item.createdAt);

  return (
    <Flexbox gap={6} {...stylex.props(styles.row)}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Tooltip title={at.format('YYYY-MM-DD HH:mm:ss')}>
            <Text fontSize={12} type={'secondary'}>
              {at.format('MM-DD HH:mm')}
            </Text>
          </Tooltip>
          <Tag color={OUTCOME_COLOR[item.outcome]} size={'small'}>
            {translate('outcome', item.outcome)}
          </Tag>
          {item.followup && <Tag size={'small'}>{t('channel.records.proactive')}</Tag>}
        </Flexbox>
        <MarkButtons
          current={item.userLabel?.label as BotWakeUserLabel | undefined}
          disabled={disabled}
          outcome={item.outcome}
          onMark={(label) => onMark(item.id, label)}
        />
      </Flexbox>
      {item.text ? (
        <Text ellipsis={{ rows: 2, tooltipWhenOverflow: true }} {...stylex.props(styles.preview)}>
          {item.text}
        </Text>
      ) : (
        <Tooltip title={t('channel.records.purgedHint')}>
          <Text italic type={'secondary'}>
            {t('channel.records.purged')}
          </Text>
        </Tooltip>
      )}
      <Text fontSize={12} type={'secondary'}>
        {item.finalReason ? translate('reason', item.finalReason) : '--'}
        {item.agentLabel &&
          ` · ${t('channel.records.silenced')}${
            item.agentLabel.reason ? `: ${translate('noReplyReason', item.agentLabel.reason)}` : ''
          }`}
      </Text>
    </Flexbox>
  );
};
