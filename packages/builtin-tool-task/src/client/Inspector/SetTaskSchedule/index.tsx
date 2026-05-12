'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SetTaskScheduleParams, SetTaskScheduleState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  identifierChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  modeChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorInfo};

    background: ${cssVar.colorInfoBg};
  `,
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

export const SetTaskScheduleInspector = memo<
  BuiltinInspectorProps<SetTaskScheduleParams, SetTaskScheduleState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const identifier = args?.identifier || partialArgs?.identifier;
  const automationMode = args?.automationMode ?? partialArgs?.automationMode;
  const modeLabel = automationMode === null ? 'off' : automationMode;

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-task.apiName.setTaskSchedule')}</span>
      {identifier && <span className={styles.identifierChip}>{identifier}</span>}
      {modeLabel && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.modeChip}>{modeLabel}</span>
        </>
      )}
    </div>
  );
});

SetTaskScheduleInspector.displayName = 'SetTaskScheduleInspector';

export default SetTaskScheduleInspector;
