/**
 * How many of the run's newest assistant replies are searched for its report.
 * A run ends with its report plus, at most, a few trailing remarks.
 */
export const RUN_REPORT_LOOKBACK = 12;

/** A reply shorter than this is a progress note, not a report. */
const MIN_REPORT_LENGTH = 400;

/** How much longer than the final reply an earlier reply must be to count as the report. */
const REPORT_LENGTH_RATIO = 2;

/**
 * The run's earlier report, when the final reply might only be a trailing
 * remark after it.
 *
 * An agent can keep talking after it delivers. For example, Claude Code is
 * woken by a background job that finishes and acknowledges it in one line.
 * The run's last message is then that line, not the report, and a handoff
 * built from it alone tells the coordinator that nothing was delivered.
 *
 * Returns the longest earlier reply in the run's turn when it is clearly
 * longer than the final reply. Whether the final reply really defers to it is
 * a semantic call left to the handoff model, so this only supplies the
 * candidate.
 *
 * @param repliesNewestFirst - the turn's assistant replies, newest first
 * @param finalContent - the run's final reply
 */
export const selectEarlierRunReport = (
  repliesNewestFirst: readonly { content: string | null }[],
  finalContent: string,
): string | undefined => {
  const final = finalContent.trim();
  // The newest row is normally the final reply itself. Skip it only when it
  // matches, so a final reply that was never persisted leaves every row a candidate.
  const earlier =
    repliesNewestFirst[0]?.content?.trim() === final
      ? repliesNewestFirst.slice(1)
      : repliesNewestFirst;

  let report: string | undefined;
  for (const reply of earlier) {
    const content = reply.content?.trim();
    if (content && content.length > (report?.length ?? 0)) report = content;
  }

  if (!report || report.length < MIN_REPORT_LENGTH) return;
  if (report.length < final.length * REPORT_LENGTH_RATIO) return;
  return report;
};
