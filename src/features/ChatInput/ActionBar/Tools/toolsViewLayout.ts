/**
 * Row order for the flat (ungrouped) Tools popover view.
 *
 * The flat view exists so that changing a row's policy — Pinned / Auto / Disabled —
 * cannot move it. That only holds while the order depends purely on what a row is,
 * never on its activation state, which is why this takes the already state-agnostic
 * collections and interleaves them by kind:
 *
 *   app-managed rows → LobeHub's Agent Skills → the two capabilities → everything else
 *
 * The two capabilities sit between LobeHub's Agent Skills and the rest so the flat
 * view keeps the same reading order as the grouped one.
 */
export const buildFlatToolsOrder = <T>({
  capabilityItems,
  fixedItems,
  isAgentSkillItem,
  skillItems,
}: {
  capabilityItems: T[];
  fixedItems: T[];
  isAgentSkillItem: (item: T) => boolean;
  skillItems: T[];
}): T[] => [
  ...fixedItems,
  ...skillItems.filter((item) => isAgentSkillItem(item)),
  ...capabilityItems,
  ...skillItems.filter((item) => !isAgentSkillItem(item)),
];

/** State label key a row shows in the flat view (nouns, not the menu's action verbs). */
export const FLAT_ROW_STATE_LABEL_KEY = {
  auto: 'tools.activation.auto',
  disabled: 'tools.activation.disabled',
  pinned: 'tools.activation.pinned',
} as const;
