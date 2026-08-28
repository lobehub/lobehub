type CheckRepairTarget = { id: string; seq: number; title: string };

/**
 * The repair prompt points the agent at the CLI as the source of truth, so the
 * reviewer does not have to hand-summarize evidence and feedback.
 */
export const buildRepairPrompt = (acceptanceId: string) =>
  `Use the LobeHub CLI to read the latest review feedback for acceptance ${acceptanceId}:

lh acceptance feedback ${acceptanceId} --actionable

Every entry it prints (per-check comments, circled-region annotations on the evidence screenshots, and attachments) is the full set of feedback to handle this round. Fix the code item by item; then re-run verification and ingest the new result back into the SAME acceptance (reuse the existing check ids, and use supersedes for any check whose meaning changed). Keep the final report in the same language the previous rounds used.`;

export const buildCheckRepairPrompt = (acceptanceId: string, check: CheckRepairTarget) =>
  `${buildRepairPrompt(acceptanceId)}

For this pass, focus on check C${check.seq} "${check.title}" (check id: ${check.id}). Treat it as the bounded work item: read its evidence and feedback, make the necessary change, and re-verify it without disturbing unrelated accepted or ignored checks.`;

/** A per-check work action is intentionally clipboard-only; it never posts to a conversation. */
export const copyCheckRepairPrompt = async (
  acceptanceId: string,
  check: CheckRepairTarget,
  copy: (text: string) => Promise<void>,
) => copy(buildCheckRepairPrompt(acceptanceId, check));
