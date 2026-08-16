export const SKILL_ICON_SIZE = 18;

export const SKILL_ICON_GAP = 14;

// Trailing icon buttons share one box so their glyphs land on the same optical
// column; 20px is also what keeps a row at the menu item's default 32px height.
export const SKILL_TRAILING_CONTROL_SIZE = 20;

// PopoverGroup addresses its members by trigger id, which is how a row's
// right-click can open the policy menu that only its "..." button triggers.
export const policyTriggerId = (id: string) => `skill-policy-${id}`;
