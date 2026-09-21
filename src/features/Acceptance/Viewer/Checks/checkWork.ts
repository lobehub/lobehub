/**
 * The repair prompt points the agent at the CLI as the source of truth, so the
 * reviewer does not have to hand-summarize evidence and feedback.
 */
export const buildRepairPrompt = (acceptanceId: string) =>
  `Use the LobeHub CLI to read the latest review feedback for acceptance ${acceptanceId}:

lh acceptance feedback ${acceptanceId} --actionable

Every entry it prints (per-check comments, circled-region annotations on the evidence screenshots, and attachments) is the full set of feedback to handle this round. Fix the code item by item; then re-run verification and ingest the new result back into the SAME acceptance (reuse the existing check ids, and use supersedes for any check whose meaning changed). Keep the final report in the same language the previous rounds used.`;
