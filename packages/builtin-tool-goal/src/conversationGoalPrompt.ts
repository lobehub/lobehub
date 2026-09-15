import { isGoalPrompt } from './goalPrompt';

/**
 * Instructions injected into a heterogeneous agent's context (Claude Code,
 * Codex, Kimi…) when the user's message starts with `/goal`.
 *
 * Those agents never receive the builtin goal tool: they run the `lh` CLI in
 * their own shell. So `/goal` is delivered as instructions rather than a tool —
 * create the goal bound to this conversation, then plan it in the same run,
 * which the server adopts as the goal's first planning turn.
 */
export const conversationGoalPrompt = `The user's message starts with /goal. They are asking you to turn the request into a long-running Goal that you supervise from this conversation, not to do the work yourself in this run.

1. Draft the goal from the user's request, in the user's language: a short title, the requirement, and one concrete, checkable acceptance criterion per explicit requirement. Do not add requirements the user did not ask for.
2. Create it bound to this conversation (the LOBEHUB_* environment already identifies you and this conversation):
   lh goal create "<title>" --conversation -r "<requirement>" -i "<the user's ask in their words>" --criterion "<criterion>" --criterion "<criterion>" --json
   The output contains goal.id and turnToken. You are now the goal's supervising agent, and this run is its first planning turn.
3. Plan it now. Run lh goal show <goalId> --json, write a JSON plan file, and submit it once:
   lh goal plan <goalId> --token <turnToken> --file <path> --json
   Plan schema: {"action":"tasks","reason":"evidence-based rationale","tasks":[{"title":"specific task","description":"self-contained contract: inputs, output and acceptance"}]}
   Plan bounded, independent tasks; the goal's coordinator dispatches and runs them under the goal budget.
4. Then end the run with one or two sentences in the user's language: the goal is running, and what the first tasks are.

Do not execute, preview or self-check the tasks, mark them complete, change budgets, or claim the goal is achieved. Later planning turns continue in this conversation once tasks deliver.`;

/**
 * The agent-level context with the `/goal` instructions appended when the
 * prompt asks for a goal; unchanged otherwise.
 */
export const withConversationGoalPrompt = (
  agentSystemContext: string | undefined,
  prompt: unknown,
): string | undefined => {
  if (!isGoalPrompt(prompt)) return agentSystemContext;
  return agentSystemContext?.trim()
    ? `${agentSystemContext.trim()}\n\n${conversationGoalPrompt}`
    : conversationGoalPrompt;
};
