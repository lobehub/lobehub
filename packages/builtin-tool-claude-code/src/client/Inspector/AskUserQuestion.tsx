'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type AskUserQuestionArgs, ClaudeCodeApiName } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
}));

export const AskUserQuestionInspector = memo<BuiltinInspectorProps<AskUserQuestionArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.AskUserQuestion as any);
    const questions = args?.questions ?? partialArgs?.questions ?? [];
    const summary =
      questions.length === 0
        ? undefined
        : questions.length === 1
          ? questions[0]?.header || questions[0]?.question
          : `${questions[0]?.header || questions[0]?.question} +${questions.length - 1}`;

    if (isArgumentsStreaming && !summary) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{label}</span>
        {summary && <span className={styles.chip}>{summary}</span>}
      </div>
    );
  },
);

AskUserQuestionInspector.displayName = 'ClaudeCodeAskUserQuestionInspector';
