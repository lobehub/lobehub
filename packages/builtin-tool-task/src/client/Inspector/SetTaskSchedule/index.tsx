'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SetTaskScheduleParams, SetTaskScheduleState } from '../../../types';

const styles = stylex.create({
  identifierChip: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  modeChip: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorInfo,
    background: cssVar.colorInfoBg,
  },
  separator: { flexShrink: 0, color: cssVar.colorTextQuaternary },
});

export const SetTaskScheduleInspector = memo<
  BuiltinInspectorProps<SetTaskScheduleParams, SetTaskScheduleState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const identifier = pluginState?.identifier ?? args?.identifier ?? partialArgs?.identifier;
  const automationMode = args?.automationMode ?? partialArgs?.automationMode;
  const modeLabel = automationMode === null ? 'off' : automationMode;

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-task.apiName.setTaskSchedule')}
      </span>
      {identifier && <span {...stylex.props(styles.identifierChip)}>{identifier}</span>}
      {modeLabel && (
        <>
          <span {...stylex.props(styles.separator)}>·</span>
          <span {...stylex.props(styles.modeChip)}>{modeLabel}</span>
        </>
      )}
    </div>
  );
});

SetTaskScheduleInspector.displayName = 'SetTaskScheduleInspector';

export default SetTaskScheduleInspector;
