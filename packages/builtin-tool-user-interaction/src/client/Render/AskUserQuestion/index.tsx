'use client';

import {
  AskUserQuestionResult,
  type AskUserQuestionResultState,
  normalizeAskUserQuestions,
  resolveAskUserAnswers,
} from '@lobechat/shared-tool-ui/ask-user';
import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs } from '../../../types';

export const AskUserQuestionRender = memo<
  BuiltinRenderProps<AskUserQuestionArgs, AskUserQuestionResultState, string>
>(({ args, content, pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');

  return (
    <AskUserQuestionResult
      answers={resolveAskUserAnswers(pluginState, content)}
      isError={!!pluginError}
      questions={normalizeAskUserQuestions(args)}
      labels={{
        noAnswer: t('builtins.lobe-claude-code.askUserQuestion.noAnswer'),
        notAnswered: t('builtins.lobe-claude-code.askUserQuestion.notAnswered'),
      }}
    />
  );
});

AskUserQuestionRender.displayName = 'AskUserQuestionRender';

export default AskUserQuestionRender;
