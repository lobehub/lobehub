'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  iconRecorded: { flexShrink: 0, color: cssVar.colorSuccess },
  iconRejected: { flexShrink: 0, color: cssVar.colorWarning },
  meta: { flexShrink: 0, fontSize: '12px', color: cssVar.colorTextTertiary },
  summary: {
    overflow: 'hidden',
    minWidth: '0',
    maxWidth: '320px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export const VentInspector = memo<BuiltinInspectorProps<VentParams, VentState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const data = args ?? partialArgs;
    const summary = data?.summary;
    const hasContext = Boolean(summary || data?.category);
    const title = t(getTitleKey(data?.category));

    if (isArgumentsStreaming && !hasContext) {
      return (
        <div className={inspectorTextStyles.root}>
          <span className={shinyTextStyles.shinyText}>{title}</span>
        </div>
      );
    }

    const isSettled = !isArgumentsStreaming && !isLoading && !!pluginState;

    return (
      <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {title}
        </span>
        {summary && (
          <span className={cx(stylex.props(styles.summary).className, highlightTextStyles.primary)}>
            {summary}
          </span>
        )}
        {isSettled &&
          pluginState &&
          (pluginState.recorded ? (
            <Icon
              className={stylex.props(styles.iconRecorded).className}
              icon={CheckCircle2}
              size={14}
            />
          ) : (
            <>
              <Icon
                className={stylex.props(styles.iconRejected).className}
                icon={CircleAlert}
                size={14}
              />
              <span {...stylex.props(styles.meta)}>
                {t('builtins.lobe-agent.apiName.vent.rejected')}
              </span>
            </>
          ))}
      </div>
    );
  },
);

VentInspector.displayName = 'VentInspector';

export default VentInspector;
