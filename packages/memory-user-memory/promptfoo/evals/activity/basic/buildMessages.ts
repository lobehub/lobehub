import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import { activityPrompt } from '../../../../src/prompts';
import type { ExtractorTemplateProps } from '../../../../src/types';

export interface PromptVars extends ExtractorTemplateProps {
  conversation: string;
}

export const buildActivityMessages = (vars: PromptVars) => {
  const retrievedContext =
    Array.isArray(vars.retrievedContexts) && vars.retrievedContexts.length > 0
      ? vars.retrievedContexts.join('\n\n')
      : typeof vars.retrievedContexts === 'string'
        ? vars.retrievedContexts
        : 'No similar memories retrieved.';

  const rendered = renderPlaceholderTemplate(activityPrompt, {
    availableCategories: vars.availableCategories,
    language: vars.language || 'English',
    retrievedContext,
    sessionDate: vars.sessionDate || new Date().toISOString(),
    topK: vars.topK ?? 5,
    username: vars.username || 'User',
  });

  const messages = [
    { content: rendered, role: 'system' as const },
    { content: rendered, role: 'user' as const },
  ];

  if (vars.conversation) {
    messages.push({
      content: `Conversation:\n${vars.conversation}`,
      role: 'user' as const,
    });
  }

  return messages;
};
