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
