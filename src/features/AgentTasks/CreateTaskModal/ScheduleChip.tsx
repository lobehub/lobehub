'use client';

import { Block, Flexbox, Icon, Popover, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClockIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatScheduleDescription,
  formatTimezoneName,
} from '../AgentTaskDetail/scheduler/helpers';
import SchedulerForm from '../AgentTaskDetail/scheduler/SchedulerForm';
import type { ScheduleDraft } from './scheduleDraft';

const styles = stylex.create({
  popover: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

interface ScheduleChipProps {
  disabled?: boolean;
  onChange: (draft: ScheduleDraft) => void;
  value: ScheduleDraft;
}

/**
 * Create-form chip for a scheduled task: shows the drafted schedule and edits
 * it with the same form the task detail uses, before the task exists.
 */
const ScheduleChip = memo<ScheduleChipProps>(({ disabled, onChange, value }) => {
  const { t, i18n } = useTranslation('chat');

  const summary = useMemo(() => formatScheduleDescription(value.pattern, t), [value.pattern, t]);
  const timezoneName = useMemo(
    () => formatTimezoneName(value.timezone, i18n.language),
    [value.timezone, i18n.language],
  );

  return (
    <Popover
      className={stylex.props(styles.popover).className}
      disabled={disabled}
      placement="topLeft"
      trigger="click"
      content={
        <Flexbox gap={12} style={{ padding: 4, width: 400 }}>
          <Text weight={500}>{t('taskSchedule.scheduler')}</Text>
          <SchedulerForm
            maxExecutions={value.maxExecutions}
            pattern={value.pattern}
            timezone={value.timezone}
            onChange={onChange}
          />
        </Flexbox>
      }
    >
      <Block
        clickable
        horizontal
        align="center"
        gap={6}
        height={24}
        paddingBlock={3}
        paddingInline={8}
        title={`${summary} · ${timezoneName}`}
        variant={'borderless'}
      >
        <Icon color={cssVar.colorTextDescription} icon={ClockIcon} size={14} />
        <Text fontSize={12}>{summary}</Text>
      </Block>
    </Popover>
  );
});

ScheduleChip.displayName = 'ScheduleChip';

export default ScheduleChip;
