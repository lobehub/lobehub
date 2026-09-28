// ── Goal progress overview for the goal-page side conversation ──
//
// The goal detail page hosts a chat with the goal's responsible agent so a
// user can ask "how is this going?" in plain language. The page already holds
// the full Goal Graph snapshot, so the client distills it into this block and
// injects it into the last user message (same channel as the Task Manager
// context) — the agent answers from the on-screen state without tool calls.

import type { InitialGoalOverviewContext } from '@lobechat/types';

export type BuildGoalOverviewPromptInput = InitialGoalOverviewContext;

/**
 * Goal overview prompt for the goal-page conversational reference.
 */
export const buildGoalOverviewPrompt = (input: BuildGoalOverviewPromptInput): string => {
  const { findings, goal, pendingDecisions, tasks } = input;

  const lines: string[] = [
    '<goal_overview>',
    `<hint>The user is currently viewing this Goal's progress page and their questions are about it. Answer from this snapshot of the on-screen state — do not claim you cannot see the goal, and do not re-fetch it.</hint>`,
    `Goal: ${goal.title} [${goal.status}]`,
  ];

  if (goal.requirement?.trim()) lines.push(`Requirement: ${goal.requirement.trim()}`);

  if (tasks.length > 0) {
    lines.push('', `Tasks (${tasks.length}):`);
    for (const item of tasks) {
      const seq = item.seq ? `#${item.seq} ` : '';
      const attempts = item.attempts && item.attempts > 1 ? `  (attempt ${item.attempts})` : '';
      lines.push(`  ${seq}[${item.status}] ${item.title}${attempts}`);
    }
  }

  if (findings.length > 0) {
    lines.push('', `Findings (${findings.length}):`);
    for (const finding of findings) lines.push(`  - ${finding}`);
  }

  if (pendingDecisions.length > 0) {
    lines.push('', `Pending decisions waiting on the user (${pendingDecisions.length}):`);
    for (const decision of pendingDecisions) lines.push(`  - ${decision.question}`);
  }

  lines.push('</goal_overview>');
  return lines.join('\n');
};
