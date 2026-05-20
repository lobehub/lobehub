'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Play } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RunTasksParams, RunTasksState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  countBadge: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorWarning};

    background: ${cssVar.colorWarningBg};
  `,
  failedBadge: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  identifierChip: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  moreBadge: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

export const RunTasksInspector = memo<BuiltinInspectorProps<RunTasksParams, RunTasksState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const identifiers = args?.identifiers || partialArgs?.identifiers || [];
    const results = pluginState?.results || [];
    const count = results.length || identifiers.length;
    const previewId = identifiers[0] || results[0]?.identifier;
    const remaining = count - 1;
    const failed = pluginState?.failed ?? 0;

    if (isArgumentsStreaming && count === 0) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <Icon icon={Play} size={12} style={{ color: cssVar.colorWarning }} />
          <span>{t('builtins.lobe-task.apiName.runTasks')}</span>
        </div>
      );
    }

    return (
      <div
        style={{ flexWrap: 'wrap', gap: 6 }}
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <Icon icon={Play} size={12} style={{ color: cssVar.colorWarning }} />
        <span>{t('builtins.lobe-task.apiName.runTasks')}</span>
        {count > 0 && (
          <span className={styles.countBadge}>
            {t('builtins.lobe-task.runTasks.count', { count })}
          </span>
        )}
        {previewId && (
          <>
            <span className={styles.separator}>·</span>
            <span className={styles.identifierChip}>{previewId}</span>
            {remaining > 0 && (
              <span className={styles.moreBadge}>
                {t('builtins.lobe-task.runTasks.more', { count: remaining })}
              </span>
            )}
          </>
        )}
        {failed > 0 && (
          <span className={styles.failedBadge}>
            {t('builtins.lobe-task.runTasks.failedCount', { count: failed })}
          </span>
        )}
      </div>
    );
  },
);

RunTasksInspector.displayName = 'RunTasksInspector';

export default RunTasksInspector;
