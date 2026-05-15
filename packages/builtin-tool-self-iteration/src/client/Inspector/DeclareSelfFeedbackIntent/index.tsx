'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type {
  DeclareSelfFeedbackIntentParams,
  DeclareSelfFeedbackIntentState,
} from '../../../types';

const getIntentLabelKey = (data?: Partial<DeclareSelfFeedbackIntentParams>) => {
  if (data?.kind === 'memory' && data.action === 'write') {
    return 'builtins.lobe-self-feedback-intent.inspector.memory.write';
  }

  if (data?.kind === 'skill' && data.action === 'create') {
    return 'builtins.lobe-self-feedback-intent.inspector.skill.create';
  }

  if (data?.kind === 'skill' && data.action === 'refine') {
    return 'builtins.lobe-self-feedback-intent.inspector.skill.refine';
  }

  if (data?.kind === 'skill' && data.action === 'consolidate') {
    return 'builtins.lobe-self-feedback-intent.inspector.skill.consolidate';
  }

  if (data?.kind === 'gap' && data.action === 'proposal') {
    return 'builtins.lobe-self-feedback-intent.inspector.gap.proposal';
  }

  return 'builtins.lobe-self-feedback-intent.apiName.declareSelfFeedbackIntent';
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  iconAccepted: css`
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

export const DeclareSelfFeedbackIntentInspector = memo<
  BuiltinInspectorProps<DeclareSelfFeedbackIntentParams, DeclareSelfFeedbackIntentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const data = args ?? partialArgs;
  const summary = data?.summary;
  const hasContext = Boolean(summary || data?.kind || data?.action);
  const title = t(getIntentLabelKey(data));

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
        (pluginState.accepted ? (
          <Icon className={styles.iconAccepted} icon={CheckCircle2} size={14} />
        ) : (
          <>
            <Icon className={styles.iconRejected} icon={CircleAlert} size={14} />
            <span className={styles.meta}>
              {t('builtins.lobe-self-feedback-intent.inspector.rejected')}
            </span>
          </>
        ))}
    </div>
  );
});

DeclareSelfFeedbackIntentInspector.displayName = 'DeclareSelfFeedbackIntentInspector';

export default DeclareSelfFeedbackIntentInspector;
