'use client';

import { normalizeAskUserQuestions } from '@lobechat/shared-tool-ui/ask-user';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs } from '../../../types';

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
    const label = t('builtins.lobe-user-interaction.apiName.askUserQuestion');
    const argsQuestions = normalizeAskUserQuestions(args);
    const questions = argsQuestions.length ? argsQuestions : normalizeAskUserQuestions(partialArgs);
    const firstQuestion = questions[0];
    const firstSummary = firstQuestion?.header || firstQuestion?.question;
    const summary =
      questions.length > 1 && firstSummary
        ? `${firstSummary} +${questions.length - 1}`
        : firstSummary;

    if (isArgumentsStreaming && !summary) {
      return (
        <div
          className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}
          data-testid="ask-user-question-inspector"
        >
          {label}
        </div>
      );
    }

    return (
      <div
        data-testid="ask-user-question-inspector"
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

AskUserQuestionInspector.displayName = 'AskUserQuestionInspector';

export default AskUserQuestionInspector;
