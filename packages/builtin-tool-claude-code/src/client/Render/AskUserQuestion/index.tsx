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

/**
 * Claude Code host for the shared completed AskUserQuestion result.
 *
 * The interactive form remains an Intervention. Once resolved, every producer
 * (Claude Code, lobe-agent, and user-interaction) now uses the same read-only
 * question/answer hierarchy instead of diverging into bespoke or raw JSON UI.
 */
const AskUserQuestion = memo<
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

AskUserQuestion.displayName = 'CCAskUserQuestion';

export default AskUserQuestion;
