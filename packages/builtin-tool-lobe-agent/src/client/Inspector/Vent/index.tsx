'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { VentCategory, VentParams, VentState } from '../../../types';

const CATEGORY_LABEL_KEYS = {
  doc_conflict: 'builtins.lobe-agent.apiName.vent.category.doc_conflict',
  env_limitation: 'builtins.lobe-agent.apiName.vent.category.env_limitation',
  missing_tool: 'builtins.lobe-agent.apiName.vent.category.missing_tool',
  other: 'builtins.lobe-agent.apiName.vent.category.other',
  platform_bug: 'builtins.lobe-agent.apiName.vent.category.platform_bug',
  schema_mismatch: 'builtins.lobe-agent.apiName.vent.category.schema_mismatch',
} as const satisfies Record<VentCategory, string>;

const getTitleKey = (category?: VentCategory) =>
  category ? CATEGORY_LABEL_KEYS[category] : ('builtins.lobe-agent.apiName.vent' as const);

const styles = createStaticStyles(({ css, cssVar }) => ({
  iconRecorded: css`
    flex-shrink: 0;
    color: ${cssVar.colorSuccess};
  `,
  iconRejected: css`
    flex-shrink: 0;
    color: ${cssVar.colorWarning};
  `,
  meta: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  summary: css`
    overflow: hidden;

    min-width: 0;
    max-width: 320px;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export const VentInspector = memo<BuiltinInspectorProps<VentParams, VentState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const data = args ?? partialArgs;
    const summary = data?.summary;
    const hasContext = Boolean(summary || data?.category);
    const title = t(getTitleKey(data?.category));

    if (isArgumentsStreaming && !hasContext) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{title}</span>
        </div>
      );
    }

    const isSettled = !isArgumentsStreaming && !isLoading && !!pluginState;

    return (
      <div
        style={{ flexWrap: 'wrap', gap: 4 }}
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{title}</span>
        {summary && (
          <span className={cx(highlightTextStyles.primary, styles.summary)}>{summary}</span>
        )}
        {isSettled &&
          pluginState &&
          (pluginState.recorded ? (
            <Icon className={styles.iconRecorded} icon={CheckCircle2} size={14} />
          ) : (
            <>
              <Icon className={styles.iconRejected} icon={CircleAlert} size={14} />
              <span className={styles.meta}>{t('builtins.lobe-agent.apiName.vent.rejected')}</span>
            </>
          ))}
      </div>
    );
  },
);

VentInspector.displayName = 'VentInspector';

export default VentInspector;
