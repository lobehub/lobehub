import { isGoalPrompt } from './goalPrompt';

/**
 * Instructions injected into a heterogeneous agent's context (Claude Code,
 * Codex, Kimi…) when the user's message starts with `/goal`.
 *
 * Those agents never receive the builtin goal tool: they run the `lh` CLI in
 * their own shell. So `/goal` is delivered as instructions rather than a tool —
 * create the goal bound to this conversation, then plan it in the same run,
 * which the server adopts as the goal's first planning turn. A `/goal` that
 * names an existing goal binds it here (`lh goal bind-topic`) instead: the
 * `goal:manage` capability a device or gateway run needs for that is granted
 * only to `/goal` runs, so this is the bind's only entry for them.
 */
export const conversationGoalPrompt = `The user sent this request with LobeHub's /goal command (the prefix was removed before it reached you; it is not your own /goal command). They are asking you to turn the request into a long-running LobeHub Goal that you supervise from this conversation, not to do the work yourself in this run.

1. Draft the goal from the user's request, in the user's language: a short title, the requirement, and one concrete, checkable acceptance criterion per explicit requirement. Do not add requirements the user did not ask for.
2. Create it bound to this conversation (the LOBEHUB_* environment already identifies you and this conversation):
   lh goal create "<title>" --conversation -r "<requirement>" -i "<the user's ask in their words>" --criterion "<criterion>" --criterion "<criterion>" --json
   The output contains goal.id and turnToken. You are now the goal's supervising agent, and this run is its first planning turn.
3. Plan it now from the goal graph already printed by lh goal create (do not run lh goal show or other lh goal commands: this run's credentials only allow creating or binding this goal and submitting its plan). Write a JSON plan file and submit it once:
   lh goal plan <goalId> --token <turnToken> --file <path> --json
   Plan schema: {"action":"tasks","reason":"evidence-based rationale","tasks":[{"title":"specific task","description":"self-contained contract: inputs, output and acceptance"}]}
   Plan bounded, independent tasks; the goal's coordinator dispatches and runs them under the goal budget.
4. Then end the run with one or two sentences in the user's language: the goal is running, and what the first tasks are.

If the request instead asks to attach an existing goal to this conversation (it names a goal id like goal_xxx, or a /goal/goal_xxx link, to continue, bind or supervise here), do not create a new goal. Bind that one:
   lh goal bind-topic <goalId> --json
Add --force only when the user explicitly asks to move a goal that is already bound to another conversation; otherwise report the refusal and stop. If the output contains a turnToken, this run is a planning turn: plan from the goal graph it printed and submit with lh goal plan as in step 3, then end as in step 4. Without a turnToken, tasks are already in flight: do not plan, and end with one or two sentences saying the goal is now supervised from this conversation.

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
