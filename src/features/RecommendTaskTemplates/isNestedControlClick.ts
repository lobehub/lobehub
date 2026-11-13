const NESTED_CONTROL_SELECTOR = 'a, button, input, select, textarea, [role="button"]';

/**
 * Whether a click on a clickable card started on one of the card's own
 * controls (an info icon, a link, a button), which keeps its own meaning and
 * must not also trigger the card's action.
 */
export const isNestedControlClick = (target: EventTarget | null, card: Element): boolean => {
  if (!(target instanceof Element)) return false;
  const control = target.closest(NESTED_CONTROL_SELECTOR);
  return !!control && control !== card && card.contains(control);
};
