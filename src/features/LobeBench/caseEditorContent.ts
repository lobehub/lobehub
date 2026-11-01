import type { EvalCaseEnvironment } from '@lobechat/types';

interface CaseContentDraft {
  category: string;
  environment: EvalCaseEnvironment;
  expected?: string;
  input: string;
  turns: Array<{ content: string; role: 'assistant' | 'user' }>;
}

/** Build the content patch shared by creating and editing a case. */
export const buildCaseContent = ({
  category,
  environment,
  expected,
  input,
  turns,
}: CaseContentDraft) => ({
  category: category.trim(),
  // An empty object clears inline overrides; omission would preserve them on update.
  environment,
  ...(expected && { expected }),
  input: input.trim(),
  messages: turns.filter((turn) => turn.content.trim()),
});
