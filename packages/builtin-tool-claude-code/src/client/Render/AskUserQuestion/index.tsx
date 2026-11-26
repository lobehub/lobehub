'use client';

import {
  AskUserQuestionResult,
  type AskUserQuestionResultState,
  normalizeAskUserQuestions,
  resolveAskUserAnswers,
} from '@lobechat/shared-tool-ui/ask-user';
import type { BuiltinRenderProps } from '@lobechat/types';
import { type ComponentProps, memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs } from '../../../types';
import PermissionRequestResult from '../PermissionRequest';

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
  const { t } = useTranslation(['plugin', 'tool']);

  return (
    <AskUserQuestionResult
      answers={resolveAskUserAnswers(pluginState, content)}
      isError={!!pluginError}
      questions={normalizeAskUserQuestions(args)}
      labels={{
        noAnswer: t('plugin:builtins.lobe-claude-code.askUserQuestion.noAnswer'),
        notAnswered: t('plugin:builtins.lobe-claude-code.askUserQuestion.notAnswered'),
        recommendedTag: t('tool:claudeCode.askUserQuestion.recommendedTag'),
        supplement: t('tool:claudeCode.askUserQuestion.supplement.enter'),
      }}
    />
  );
});

AskUserQuestion.displayName = 'CCAskUserQuestion';

/**
 * Claude Code's permission requests ride the same
 * AskUserQuestion-shaped card every review surface understands; their extra
 * `claudeCodePermission` detail gets the dedicated result instead.
 */
const AskUserQuestionOrPermission = memo<
  BuiltinRenderProps<AskUserQuestionArgs, AskUserQuestionResultState, string>
>((props) =>
  (props.args as { claudeCodePermission?: unknown } | undefined)?.claudeCodePermission ? (
    <PermissionRequestResult
      {...(props as unknown as ComponentProps<typeof PermissionRequestResult>)}
    />
  ) : (
    <AskUserQuestion {...props} />
  ),
);

AskUserQuestionOrPermission.displayName = 'CCAskUserQuestionOrPermission';

export default AskUserQuestionOrPermission;
