'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Play } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RunTasksParams, RunTasksState } from '../../../types';

const styles = stylex.create({
  countBadge: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorWarning,
    background: cssVar.colorWarningBg,
  },
  failedBadge: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorError,
    background: cssVar.colorErrorBg,
  },
  identifierChip: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  moreBadge: { flexShrink: 0, fontSize: '12px', color: cssVar.colorTextTertiary },
  separator: { flexShrink: 0, color: cssVar.colorTextQuaternary },
});

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
        <div className={inspectorTextStyles.root}>
          <Icon icon={Play} size={12} style={{ color: cssVar.colorWarning }} />
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-task.apiName.runTasks')}
          </span>
        </div>
      );
    }

    return (
      <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 6 }}>
        <Icon icon={Play} size={12} style={{ color: cssVar.colorWarning }} />
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-task.apiName.runTasks')}
        </span>
        {count > 0 && (
          <span {...stylex.props(styles.countBadge)}>
            {t('builtins.lobe-task.runTasks.count', { count })}
          </span>
        )}
        {previewId && (
          <>
            <span {...stylex.props(styles.separator)}>·</span>
            <span {...stylex.props(styles.identifierChip)}>{previewId}</span>
            {remaining > 0 && (
              <span {...stylex.props(styles.moreBadge)}>
                {t('builtins.lobe-task.runTasks.more', { count: remaining })}
              </span>
            )}
          </>
        )}
        {failed > 0 && (
          <span {...stylex.props(styles.failedBadge)}>
            {t('builtins.lobe-task.runTasks.failedCount', { count: failed })}
          </span>
        )}
      </div>
    );
  },
);

RunTasksInspector.displayName = 'RunTasksInspector';

export default RunTasksInspector;
