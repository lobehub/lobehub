'use client';

import { normalizeAskUserQuestions } from '@lobechat/shared-tool-ui/ask-user';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs } from '../../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
});

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
      <div className={inspectorTextStyles.root} data-testid="ask-user-question-inspector">
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {label}
        </span>
        {summary && <span {...stylex.props(styles.chip)}>{summary}</span>}
      </div>
    );
  },
);

AskUserQuestionInspector.displayName = 'AskUserQuestionInspector';

export default AskUserQuestionInspector;
