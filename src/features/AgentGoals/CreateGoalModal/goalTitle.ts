export const deriveGoalTitle = (instruction: string) => {
  const normalized = instruction.trim();
  const firstSentence = normalized.split(/[\n，。！？!?]/)[0].trim();

  return (firstSentence || normalized).slice(0, 48);
};

/**
 * The title a goal is created with. Never the instruction: a pasted prompt as
 * the title took over the goal page. A title the user did not write — left
 * blank, or the stopgap a failed draft put there — is named by the model once
 * the goal exists.
 */
export const resolveSubmittedGoalTitle = ({
  fallbackTitle,
  instruction,
  name,
}: {
  /** The stopgap title a failed draft left in the field, if any. */
  fallbackTitle?: string;
  instruction: string;
  name: string;
}) => {
  const typed = name.trim();
  const title = typed || deriveGoalTitle(instruction);
  return { needsGeneratedTitle: !typed || typed === fallbackTitle, title };
};

/**
 * The title after a successful draft. Drafting again from the review step keeps
 * a title the user edited there; otherwise the generated one is used.
 */
export const resolveDraftedTitle = ({
  generated,
  previousFallback,
  retrying,
  typed,
}: {
  generated: string;
  /** The stopgap title the failed draft left in the field, if any. */
  previousFallback?: string;
  /** Drafting again from the review step, rather than for the first time. */
  retrying: boolean;
  /** What was in the field before the draft, trimmed. */
  typed: string;
}) => (retrying && typed && typed !== previousFallback ? typed : generated);

/**
 * The stopgap title to remember when a criteria draft fails. Only a title the
 * user did not write stays a stopgap: one they typed or edited before this
 * draft is theirs, even when the draft fails again.
 */
export const resolveFallbackTitle = ({
  name,
  previousFallback,
  typed,
}: {
  /** The title the field holds after the failed draft. */
  name: string;
  previousFallback?: string;
  /** What was in the field before the draft, trimmed. */
  typed: string;
}) => (!typed || typed === previousFallback ? name : undefined);
