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
  const { t } = useTranslation(['plugin', 'tool']);

  return (
    <AskUserQuestionResult
      answers={resolveAskUserAnswers(pluginState, content)}
      isError={!!pluginError}
      questions={normalizeAskUserQuestions(args)}
      labels={{
        noAnswer: t('plugin:builtins.lobe-claude-code.askUserQuestion.noAnswer'),
        notAnswered: t('plugin:builtins.lobe-claude-code.askUserQuestion.notAnswered'),
        recommendedTag: t('tool:askUserQuestion.recommendedTag'),
      }}
    />
  );
});

AskUserQuestionRender.displayName = 'AskUserQuestionRender';

export default AskUserQuestionRender;
