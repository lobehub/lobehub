export type BubbleLineKind = 'brief' | 'fallback' | 'promo';

interface BubbleLineInput {
  hasBrief: boolean;
  hasPromo: boolean;
}

/**
 * The portrait has one mouth, so its lines queue rather than stack: a promo
 * interrupts the brief, and dismissing the promo hands the brief back instead
 * of leaving the agent mute.
 */
export const resolveBubbleLine = ({ hasPromo, hasBrief }: BubbleLineInput): BubbleLineKind => {
  if (hasPromo) return 'promo';
  if (hasBrief) return 'brief';
  return 'fallback';
};
