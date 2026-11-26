import { resolveAskUserAnswers } from '@lobechat/shared-tool-ui/ask-user';

export const isAnsweredAskUserQuestion = (
  apiName: string,
  args: Record<string, unknown> | undefined,
  result: { content: string | null; state?: any } | undefined,
): boolean =>
  apiName === 'askUserQuestion' &&
  !args?.claudeCodePermission &&
  !!resolveAskUserAnswers(result?.state, result?.content);
