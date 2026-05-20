'use client';

import type { BuiltinInspectorProps, TaskStatus } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateTaskStatusParams, UpdateTaskStatusState } from '../../../types';

const STATUS_TONE: Partial<Record<TaskStatus, { bg: string; fg: string }>> = {
  backlog: { bg: cssVar.colorFillTertiary, fg: cssVar.colorTextSecondary },
  canceled: { bg: cssVar.colorFillTertiary, fg: cssVar.colorTextSecondary },
  completed: { bg: cssVar.colorSuccessBg, fg: cssVar.colorSuccess },
  failed: { bg: cssVar.colorErrorBg, fg: cssVar.colorError },
  paused: { bg: cssVar.colorFillTertiary, fg: cssVar.colorTextSecondary },
  running: { bg: cssVar.colorWarningBg, fg: cssVar.colorWarning },
  scheduled: { bg: cssVar.colorInfoBg, fg: cssVar.colorInfo },
};

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
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
  statusChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
  `,
}));

export const UpdateTaskStatusInspector = memo<
  BuiltinInspectorProps<UpdateTaskStatusParams, UpdateTaskStatusState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const identifier = args?.identifier || partialArgs?.identifier;
  const status = (args?.status || partialArgs?.status) as TaskStatus | undefined;
  const tone = status ? STATUS_TONE[status] : undefined;

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 4 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-task.apiName.updateTaskStatus')}</span>
      {identifier && <span className={styles.identifierChip}>{identifier}</span>}
      {status && (
        <>
          <span className={styles.separator}>·</span>
          <span
            className={styles.statusChip}
            style={{
              background: tone?.bg ?? cssVar.colorFillTertiary,
              color: tone?.fg ?? cssVar.colorTextSecondary,
            }}
          >
            {status}
          </span>
        </>
      )}
    </div>
  );
});

UpdateTaskStatusInspector.displayName = 'UpdateTaskStatusInspector';

export default UpdateTaskStatusInspector;
