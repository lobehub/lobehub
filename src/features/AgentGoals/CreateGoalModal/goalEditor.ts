/**
 * Props both create-goal instruction editors share.
 *
 * `blockImageCaretGuard` opens an empty line after a block attachment (video,
 * block image): inserted at the end of the description, it otherwise leaves
 * no line to keep writing on (T-3387).
 */
export const GOAL_INSTRUCTION_EDITOR_PROPS = {
  blockImageCaretGuard: true,
  floatingToolbar: false,
} as const;
