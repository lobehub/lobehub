import type { EvalCaseEnvironment, ImportedMessage } from '@lobechat/types';

interface CaseContentDraft {
  category: string;
  environment: EvalCaseEnvironment;
  expected?: string;
  input: string;
  originalEnvironment?: EvalCaseEnvironment;
  originalMessages?: ImportedMessage[];
  turns: Array<{ content: string; role: 'assistant' | 'user' }>;
}

/** The form edits five fields; the rest of the inline runtime setup stays intact. */
const mergeCaseEnvironment = (
  original: EvalCaseEnvironment = {},
  edited: EvalCaseEnvironment,
): EvalCaseEnvironment => {
  const environment = { ...original, ...edited };
  for (const key of ['sessionDate', 'timezone'] as const) {
    if (original[key] && !edited[key]) delete environment[key];
  }
  if (original.mock?.services.length && !edited.mock) delete environment.mock;

  const agent = { ...original.agent, ...edited.agent };
  if (original.agent?.systemRole && !edited.agent?.systemRole) delete agent.systemRole;
  if (original.agent?.plugins?.length && !edited.agent?.plugins) delete agent.plugins;
  if (Object.keys(agent).length > 0) environment.agent = agent;
  else if (Object.keys(original.agent ?? {}).length > 0) delete environment.agent;

  return environment;
};

const messagesAfterEdit = (
  turns: CaseContentDraft['turns'],
  original?: ImportedMessage[],
): ImportedMessage[] => {
  if (original) {
    const visible = original.filter(({ role }) => role === 'user' || role === 'assistant');
    if (
      visible.length === turns.length &&
      visible.every(
        (message, index) =>
          message.role === turns[index].role && message.content === turns[index].content,
      )
    )
      return original;
  }
  return turns.filter((turn) => turn.content.trim());
};

/** Build the content patch shared by creating and editing a case. */
export const buildCaseContent = ({
  category,
  environment,
  expected,
  input,
  originalEnvironment,
  originalMessages,
  turns,
}: CaseContentDraft) => ({
  category: category.trim(),
  // An empty object clears inline overrides; omission would preserve them on update.
  environment: mergeCaseEnvironment(originalEnvironment, environment),
  ...(expected && { expected }),
  input: input.trim(),
  messages: messagesAfterEdit(turns, originalMessages),
});
