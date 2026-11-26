export type EscapeKeyAction = 'blur' | 'ignore' | 'skip';

export const resolveEscapeKey = ({
  canSkip,
  hasDraft,
  typingInCard,
}: {
  canSkip: boolean;
  hasDraft: boolean;
  typingInCard: boolean;
}): EscapeKeyAction => {
  if (typingInCard) return 'blur';
  if (!canSkip || hasDraft) return 'ignore';
  return 'skip';
};

export const stepQuestion = (active: number, delta: number, total: number): number =>
  (((active + delta) % total) + total) % total;
